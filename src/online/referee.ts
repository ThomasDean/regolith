// The referee for online games. It owns the full game state and is the only thing that ever
// applies actions to it: it checks the caller holds the seat that must decide, runs the rules
// engine, plays CPU seats one decision at a time (clients ask for each step so CPU moves are
// paced and animated like in hotseat play), and hands each player a view with everyone
// else's hidden cards removed.
//
// It is pure TypeScript with the storage behind an interface, so the same code runs in the
// Supabase Edge Function (server/edge.ts) and in the tests with an in-memory store.
import type { Action, GameState, Level } from '../engine/types';
import { applyActionMut, cleanExpansions, createGame, forfeitMut } from '../engine/game';
import { cpuAction } from '../engine/ai/cpu';
import { decider } from '../engine/moves';
import { HIDDEN, type PlayReply, type PlayRequest, type RoomRow, type SeatRow } from './protocol';
import { BOARD_IDS, type BoardId } from '../engine/board';
import { availability, maDef } from '../engine/ma';

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

/** Something worth a push notification, for the players listed (user ids). */
export interface Notice {
  room: string;
  users: string[];
  title: string;
  body: string;
  /** one notification per game: a newer one replaces the older */
  tag: string;
}

export interface Store {
  load(room: string): Promise<Loaded | null>;
  /** Saves if the room is still at `version`; returns the new version, or null if it moved on. */
  save(room: string, version: number, patch: SavePatch): Promise<number | null>;
  /** Optional: tells players it's their move. Best effort; must never make the move itself fail. */
  notify?(notice: Notice): void | Promise<void>;
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

/** The room's map, milestones/awards and expansions, checked: unknown maps fall back to Tharsis, bad lists are refused. */
export function gameSettings(room: RoomRow): { board: BoardId; milestones?: string[]; awards?: string[]; expansions: ReturnType<typeof cleanExpansions> } {
  const st = room.settings ?? {};
  const board = BOARD_IDS.includes(st.board as BoardId) ? (st.board as BoardId) : 'tharsis';
  const expansions = cleanExpansions(st.expansions && typeof st.expansions === 'object' ? st.expansions : undefined);
  const ok = (xs: unknown, kind: 'milestone' | 'award') =>
    Array.isArray(xs) && xs.length === 5 && new Set(xs).size === 5 && xs.every((id) => typeof id === 'string' && maDef(id)?.kind === kind && !availability(board, id, expansions));
  if (st.milestones !== undefined && !ok(st.milestones, 'milestone')) throw new HttpError(400, 'Those milestones can’t be used');
  if (st.awards !== undefined && !ok(st.awards, 'award')) throw new HttpError(400, 'Those awards can’t be used');
  return { board, milestones: st.milestones, awards: st.awards, expansions };
}

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
  if (v.preludeDeck) v.preludeDeck = v.preludeDeck.map(() => HIDDEN);
  if (v.turmoil) v.turmoil = { ...v.turmoil, deck: v.turmoil.deck.map(() => HIDDEN) };
  for (const p of v.players) {
    if (p.id === seat) continue;
    p.hand = p.hand.map(() => HIDDEN);
    if (p.setup) p.setup = { corps: p.setup.corps.map(() => HIDDEN), cards: p.setup.cards.map(() => HIDDEN), ...(p.setup.preludes ? { preludes: p.setup.preludes.map(() => HIDDEN) } : {}) };
    if (p.research) p.research = p.research.map(() => HIDDEN);
    if (p.preludes) p.preludes = p.preludes.map(() => HIDDEN);
  }
  if (v.prompt && v.prompt.pid !== seat && v.prompt.kind === 'cards') v.prompt = { ...v.prompt, cards: v.prompt.cards.map(() => HIDDEN) };
  // playing a card from hand (Ecology Experts, Eccentric Sponsor) offers hand cards
  if (v.prompt && v.prompt.pid !== seat && v.prompt.kind === 'card' && v.prompt.item.op.k === 'playFromHand') v.prompt = { ...v.prompt, options: v.prompt.options.map(() => HIDDEN) };
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

const TURN_TITLE: Record<string, string> = {
  setup: 'Choose your corporation',
  research: 'Choose your research cards',
  finalGreenery: 'Last chance for greenery',
};

/**
 * Who to nudge after a save: players whose decision the game has just started waiting on
 * (a new turn, or a corporation or research choice), or everyone once the game ends. Never
 * the player who made the move, who is looking at the game already.
 */
export function noticesFor(room: RoomRow, patch: SavePatch, actor: string): Notice | null {
  const seats = patch.seats ?? room.seats;
  const humans = (idx: number[]) => [...new Set(idx.flatMap((i) => (seats[i]?.kind === 'human' && seats[i].user && seats[i].user !== actor ? [seats[i].user!] : [])))];
  const others = (u: string) => seats.filter((x) => x.user !== u).map((x) => x.name);
  const withWho = (u: string) => { const n = others(u); return n.length ? ` · with ${n.length > 2 ? `${n[0]} and ${n.length - 1} others` : n.join(' and ')}` : ''; };

  if (patch.status === 'over' && room.status !== 'over') {
    const users = humans(seats.map((_, i) => i));
    return users.length ? { room: room.id, users, title: 'Game over', body: `Generation ${patch.generation}: the final scores are in.`, tag: room.id } : null;
  }
  if (patch.status !== 'playing') return null;
  // a seat handed back from a CPU to its player while the game waits on it counts as new, too
  const handedBack = (patch.seats ?? []).flatMap((x, i) => (x.kind === 'human' && room.seats[i]?.kind !== 'human' ? [i] : []));
  const fresh = patch.waiting.filter((w) => !room.waiting.includes(w) || handedBack.includes(w));
  const users = humans(fresh);
  if (!users.length) return null;
  const title = TURN_TITLE[patch.phase] ?? 'Your turn';
  // name the other players when there is a single recipient; otherwise keep it generic
  const body = `Generation ${patch.generation}${users.length === 1 ? withWho(users[0]) : ''}`;
  return { room: room.id, users, title, body, tag: room.id };
}

/** Saves, or says the room changed underneath us. */
async function commit(store: Store, l: Loaded, patch: SavePatch, actor: string): Promise<RoomRow | null> {
  const v = await store.save(l.room.id, l.room.version, patch);
  if (v === null) return null;
  if (store.notify) {
    try {
      const n = noticesFor(l.room, patch, actor);
      if (n) Promise.resolve(store.notify(n)).catch((e) => console.error('notify failed', e));
    } catch (e) {
      console.error('notify failed', e);
    }
  }
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
      const s = createGame(room.seats.map((x) => ({ name: x.name, color: x.color, cpu: x.kind === 'human' ? null : (x.kind as Level) })), { corporateEra: room.corporate_era, ...gameSettings(room) });
      const saved = await commit(store, l, patchFor(room, s, {}, []), uid);
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
      if (me.forfeited) throw new HttpError(409, 'You forfeited this game');
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
      const saved = await commit(store, l, patchFor(room, s, pending, log), uid);
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
      const saved = await commit(store, l, patchFor(room, s, pending, log), uid);
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
      if (kind === 'human' && (room.seats[i].forfeited || l.state.players[i].forfeited)) throw new HttpError(409, 'That player forfeited; the seat stays a CPU');
      const s = structuredClone(l.state);
      s.players[i].cpu = kind === 'human' ? null : kind;
      const seats = room.seats.map((x, j) => (j === i ? { ...x, kind } : x));
      const saved = await commit(store, l, patchFor(room, s, l.pending, [], seats), uid);
      return saved ? reply(saved, s, l.pending, uid) : null;
    }

    case 'forfeit': {
      if (!l.state || room.status !== 'playing') throw new HttpError(409, 'This game is not being played');
      if (seat < 0) throw new HttpError(403, 'You are watching this game');
      if (room.seats[seat].forfeited || l.state.players[seat].forfeited) throw new HttpError(409, 'You already forfeited');
      const s = structuredClone(l.state);
      // a pick waiting for its turn is dropped: the CPU taking the seat makes its own
      const pending = { ...l.pending };
      delete pending[seat];
      try { forfeitMut(s, seat); } catch (e) { throw new HttpError(422, (e as Error).message); }
      const kind = s.players[seat].cpu ?? 'normal';
      const seats = room.seats.map((x, j) => (j === seat ? { ...x, kind, forfeited: true } : x));
      const saved = await commit(store, l, patchFor(room, s, pending, [], seats), uid);
      return saved ? reply(saved, s, pending, uid) : null;
    }

    default:
      throw new HttpError(400, 'Unknown request');
  }
}
