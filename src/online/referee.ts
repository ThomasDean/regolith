// The referee for online games. It owns the full game state and is the only thing that ever
// applies actions to it: it checks the caller holds the seat that must decide, runs the rules
// engine, plays CPU seats one decision at a time (clients ask for each step so CPU moves are
// paced and animated like in hotseat play), and hands each player a view with everyone
// else's hidden cards removed.
//
// It is pure TypeScript with the storage behind an interface, so the same code runs in the
// Supabase Edge Function (server/edge.ts) and in the tests with an in-memory store.
import type { Action, GameState, Level } from '../engine/types';
import { applyActionMut, createGame } from '../engine/game';
import { cpuAction } from '../engine/ai/cpu';
import { decider } from '../engine/moves';
import { HIDDEN, type PlayReply, type PlayRequest, type RoomRow, type SeatRow } from './protocol';

export interface Loaded { room: RoomRow; state: GameState | null; pending: Record<string, Action> }

export interface SavePatch {
  state: GameState;
  pending: Record<string, Action>;
  actions: { seat: number; a: Action }[];
  status: RoomRow['status'];
  phase: string;
  generation: number;
  decider: number | null;
  waiting: number[];
  seats: SeatRow[] | null;
}

export interface Store {
  load(room: string): Promise<Loaded | null>;
  /** Saves if the room is still at `version`; returns the new version, or null if it moved on. */
  save(room: string, version: number, patch: SavePatch): Promise<number | null>;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const LEVELS: Level[] = ['easy', 'normal', 'hard'];
const simultaneous = (s: GameState) => (s.phase === 'setup' || s.phase === 'research') && !s.prompt;

/** Time a single advance may spend on back-to-back CPU corporation/research picks. */
const PICK_BUDGET_MS = 700;

export function seatOf(room: RoomRow, uid: string): number {
  return room.seats.findIndex((x) => x.user === uid);
}

/** Who still has to choose: several players during setup and research, otherwise the decider. */
export function waitingOf(s: GameState, pending: Record<string, Action>): number[] {
  if (s.phase === 'over') return [];
  if (simultaneous(s)) {
    return s.players.filter((p) => (s.phase === 'setup' ? !!p.setup : !!p.research) && !pending[p.id]).map((p) => p.id);
  }
  return [decider(s)];
}

/** The game as `seat` may see it. */
export function viewFor(s: GameState, seat: number): GameState {
  const v = structuredClone(s);
  v.rng = 0;
  v.options = { ...v.options, seed: 0 };
  v.deck = v.deck.map(() => HIDDEN);
  v.discard = v.discard.map(() => HIDDEN);
  for (const p of v.players) {
    if (p.id === seat) continue;
    p.hand = p.hand.map(() => HIDDEN);
    if (p.setup) p.setup = { corps: p.setup.corps.map(() => HIDDEN), cards: p.setup.cards.map(() => HIDDEN) };
    if (p.research) p.research = p.research.map(() => HIDDEN);
  }
  if (v.prompt && v.prompt.pid !== seat && v.prompt.kind === 'cards') v.prompt = { ...v.prompt, cards: v.prompt.cards.map(() => HIDDEN) };
  return v;
}

/** Applies queued corporation/research picks whose turn has come round. */
function flush(s: GameState, pending: Record<string, Action>, log: SavePatch['actions']) {
  while (simultaneous(s) && pending[s.active]) {
    const seat = s.active;
    const a = pending[seat];
    delete pending[seat];
    const before = structuredClone(s);
    try {
      applyActionMut(s, a);
      log.push({ seat, a });
    } catch {
      // the pick was checked when it came in, so this shouldn't happen; drop it and let them choose again
      Object.assign(s, before);
      break;
    }
  }
}

function reply(room: RoomRow, state: GameState | null, pending: Record<string, Action>, uid: string): PlayReply {
  const seat = seatOf(room, uid);
  return { room, seat, view: state ? viewFor(state, seat) : null, queued: Object.keys(pending).map(Number) };
}

function patchFor(room: RoomRow, s: GameState, pending: Record<string, Action>, actions: SavePatch['actions'], seats: SeatRow[] | null = null): SavePatch {
  return {
    state: s, pending, actions, seats,
    status: s.phase === 'over' ? 'over' : 'playing',
    phase: s.phase, generation: s.generation, decider: s.phase === 'over' ? null : decider(s), waiting: waitingOf(s, pending),
  };
}

async function loadRoom(store: Store, id: string, uid: string): Promise<Loaded> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown game');
  const got = await store.load(id);
  if (!got || !got.room) throw new HttpError(404, 'That game no longer exists');
  if (!got.room.members.includes(uid) && seatOf(got.room, uid) < 0) throw new HttpError(403, 'You are not in this game');
  got.pending ??= {};
  return got;
}

/** Saves, or says the room changed underneath us. */
async function commit(store: Store, l: Loaded, patch: SavePatch): Promise<RoomRow | null> {
  const v = await store.save(l.room.id, l.room.version, patch);
  if (v === null) return null;
  return {
    ...l.room, version: v, status: patch.status, phase: patch.phase, generation: patch.generation, decider: patch.decider,
    waiting: patch.waiting, seats: patch.seats ?? l.room.seats, updated_at: new Date().toISOString(),
  };
}

export async function handle(req: PlayRequest, uid: string, store: Store, now: () => number = Date.now): Promise<PlayReply> {
  if (!req || typeof req !== 'object') throw new HttpError(400, 'Bad request');
  // optimistic concurrency: if someone else saved first, reload and try again
  for (let attempt = 0; attempt < 4; attempt++) {
    const l = await loadRoom(store, req.room, uid);
    const out = await step(req, uid, store, l, now);
    if (out) return out;
  }
  throw new HttpError(409, 'The game is busy; try again');
}

async function step(req: PlayRequest, uid: string, store: Store, l: Loaded, now: () => number): Promise<PlayReply | null> {
  const { room } = l;
  const seat = seatOf(room, uid);
  switch (req.op) {
    case 'view':
      return reply(room, l.state, l.pending, uid);

    case 'start': {
      if (room.host !== uid) throw new HttpError(403, 'Only the host can start the game');
      if (room.status !== 'lobby' || l.state) return reply(room, l.state, l.pending, uid);
      const open = room.seats.filter((x) => x.kind === 'open').length;
      if (open) throw new HttpError(409, `Waiting for ${open} more player${open === 1 ? '' : 's'} to join`);
      const s = createGame(room.seats.map((x) => ({ name: x.name, color: x.color, cpu: x.kind === 'human' ? null : (x.kind as Level) })), { corporateEra: room.corporate_era });
      const saved = await commit(store, l, patchFor(room, s, {}, []));
      return saved ? reply(saved, s, {}, uid) : null;
    }

    case 'act': {
      if (!l.state || room.status !== 'playing') throw new HttpError(409, 'This game is not being played');
      if (seat < 0) throw new HttpError(403, 'You are watching this game');
      const a = req.action;
      if (!a || typeof a !== 'object' || typeof (a as { t?: unknown }).t !== 'string') throw new HttpError(400, 'Bad action');
      const s = structuredClone(l.state);
      const pending = { ...l.pending };
      const log: SavePatch['actions'] = [];
      const me = s.players[seat];
      if (me.cpu) throw new HttpError(409, 'A CPU is playing your seat');
      if (decider(s) !== seat) {
        // corporation and research picks can be made at once and are applied in turn order
        const early = simultaneous(s) && ((s.phase === 'setup' && a.t === 'setup' && me.setup) || (s.phase === 'research' && a.t === 'research' && me.research));
        if (!early) throw new HttpError(409, 'It’s not your turn');
        if (pending[seat]) throw new HttpError(409, 'You already chose');
        const trial = structuredClone(s);
        trial.active = seat;
        try { applyActionMut(trial, a); } catch (e) { throw new HttpError(422, (e as Error).message); }
        pending[seat] = a;
      } else {
        try { applyActionMut(s, a); } catch (e) { throw new HttpError(422, (e as Error).message); }
        log.push({ seat, a });
      }
      flush(s, pending, log);
      const saved = await commit(store, l, patchFor(room, s, pending, log));
      return saved ? reply(saved, s, pending, uid) : null;
    }

    case 'advance': {
      // anyone in the room may ask for the next CPU step; stale requests do nothing
      if (!l.state || room.status !== 'playing' || req.version !== room.version) return reply(room, l.state, l.pending, uid);
      const s = structuredClone(l.state);
      const pending = { ...l.pending };
      const log: SavePatch['actions'] = [];
      let d = decider(s);
      if (!s.players[d].cpu) return reply(room, l.state, l.pending, uid);
      const t0 = now();
      for (let guard = 0; guard < 60; guard++) {
        const a = cpuAction(s, s.players[d].cpu!);
        applyActionMut(s, a);
        log.push({ seat: d, a });
        flush(s, pending, log);
        if (s.phase === 'over') break;
        const nd = decider(s);
        // a CPU finishing its own follow-up choices (where to put the tile…) is one step
        if (s.prompt && nd === d && s.players[d].cpu) continue;
        // corporation and research picks are quick and hidden, so batch them
        if (simultaneous(s) && s.players[nd].cpu && now() - t0 < PICK_BUDGET_MS) { d = nd; continue; }
        break;
      }
      const saved = await commit(store, l, patchFor(room, s, pending, log));
      return saved ? reply(saved, s, pending, uid) : reply(room, l.state, l.pending, uid);
    }

    case 'seat': {
      // the host can hand a seat to a CPU (someone dropped out) and give it back later
      if (room.host !== uid) throw new HttpError(403, 'Only the host can change seats');
      if (!l.state || room.status !== 'playing') throw new HttpError(409, 'This game is not being played');
      const i = req.seat;
      if (!Number.isInteger(i) || i < 0 || i >= room.seats.length) throw new HttpError(400, 'No such seat');
      if (room.seats[i].user === uid) throw new HttpError(409, 'You can’t hand your own seat to a CPU');
      const kind = req.kind;
      if (kind !== 'human' && !LEVELS.includes(kind)) throw new HttpError(400, 'Unknown seat type');
      if (kind === 'human' && !room.seats[i].user) throw new HttpError(409, 'Nobody has sat there; it stays a CPU');
      const s = structuredClone(l.state);
      s.players[i].cpu = kind === 'human' ? null : kind;
      const seats = room.seats.map((x, j) => (j === i ? { ...x, kind } : x));
      const saved = await commit(store, l, patchFor(room, s, l.pending, [], seats));
      return saved ? reply(saved, s, l.pending, uid) : null;
    }

    default:
      throw new HttpError(400, 'Unknown request');
  }
}
