// The referee for online Fathom games. It owns the full game state and is the only thing that
// applies actions to it: it checks the caller holds the seat that must decide, runs the rules
// engine, plays CPU seats one decision at a time when a client asks (so CPU moves are paced and
// animated like hotseat play), and hands out views without the deck order or the random seed.
// Hands are open in Fathom, so nothing else is hidden.
//
// Pure TypeScript with the storage behind an interface: the same code runs in the fathom-play
// Edge Function (server/fathom-edge.ts) and in the tests with an in-memory store.
import { applyActionMut, createGame, decider, forfeitMut } from '../engine/game';
import { cpuAction } from '../engine/cpu';
import type { FAction, FState, Level } from '../engine/types';
import { HttpError, type Notice } from '../../shell/referee';
import { HIDDEN, type FPlayReply, type FPlayRequest, type FRoomRow, type SeatRow } from './protocol';

export { HttpError, type Notice };

export interface FLoaded { room: FRoomRow; state: FState | null }

export interface FSavePatch {
  state: FState;
  actions: { seat: number; a: FAction | { t: 'forfeit' } }[];
  status: FRoomRow['status'];
  phase: string;
  tide: number;
  decider: number | null;
  waiting: number[];
  seats: SeatRow[] | null;
}

export interface FStore {
  load(room: string): Promise<FLoaded | null>;
  /** Saves if the room is still at `version`; returns the new version, or null if it moved on. */
  save(room: string, version: number, patch: FSavePatch): Promise<number | null>;
  /** Best effort; must never make the move itself fail. */
  notify?(notice: Notice): void | Promise<void>;
}

const LEVELS: Level[] = ['easy', 'normal', 'hard'];

export const seatOf = (room: FRoomRow, uid: string) => room.seats.findIndex((x) => x.user === uid);
export const waitingOf = (s: FState): number[] => (s.phase === 'over' ? [] : [decider(s)]);

/** The game as anyone may see it: the deck order and the seed stay on the server. */
export function viewFor(s: FState): FState {
  const v = structuredClone(s);
  v.rng = 0;
  v.options = { ...v.options, seed: 0 };
  v.deck = v.deck.map(() => HIDDEN);
  return v;
}

function reply(room: FRoomRow, state: FState | null, uid: string): FPlayReply {
  return { room, seat: seatOf(room, uid), view: state ? viewFor(state) : null };
}

function patchFor(s: FState, actions: FSavePatch['actions'], seats: SeatRow[] | null = null): FSavePatch {
  const over = s.phase === 'over';
  return { state: s, actions, seats, status: over ? 'over' : 'playing', phase: s.phase, tide: s.tide, decider: over ? null : decider(s), waiting: waitingOf(s) };
}

/** Who to nudge after a save: a human whose turn it has just become, or everyone at the end. */
export function noticesFor(room: FRoomRow, patch: FSavePatch, actor: string): Notice | null {
  const seats = patch.seats ?? room.seats;
  const humans = (idx: number[]) => [...new Set(idx.flatMap((i) => (seats[i]?.kind === 'human' && seats[i].user && !seats[i].forfeited && seats[i].user !== actor ? [seats[i].user!] : [])))];
  const url = `/fathom?room=${room.id}`;
  if (patch.status === 'over' && room.status !== 'over') {
    const users = humans(seats.map((_, i) => i));
    return users.length ? { room: room.id, users, title: 'Fathom: game over', body: 'The final scores are in.', tag: room.id, url } : null;
  }
  if (patch.status !== 'playing') return null;
  const handedBack = (patch.seats ?? []).flatMap((x, i) => (x.kind === 'human' && room.seats[i]?.kind !== 'human' ? [i] : []));
  const fresh = patch.waiting.filter((w) => !room.waiting.includes(w) || handedBack.includes(w));
  const users = humans(fresh);
  if (!users.length) return null;
  const others = seats.filter((x) => x.user !== users[0]).map((x) => x.name);
  const withWho = users.length === 1 && others.length ? ` · with ${others.length > 2 ? `${others[0]} and ${others.length - 1} others` : others.join(' and ')}` : '';
  return { room: room.id, users, title: 'Fathom: your turn', body: `Tide ${patch.tide}${withWho}`, tag: room.id, url };
}

async function commit(store: FStore, l: FLoaded, patch: FSavePatch, actor: string): Promise<FRoomRow | null> {
  const v = await store.save(l.room.id, l.room.version, patch);
  if (v === null) return null;
  if (store.notify) {
    try {
      const n = noticesFor(l.room, patch, actor);
      if (n) Promise.resolve(store.notify(n)).catch((e) => console.error('notify failed', e));
    } catch (e) { console.error('notify failed', e); }
  }
  return { ...l.room, version: v, status: patch.status, phase: patch.phase, tide: patch.tide, decider: patch.decider, waiting: patch.waiting, seats: patch.seats ?? l.room.seats, updated_at: new Date().toISOString() };
}

async function loadRoom(store: FStore, id: string, uid: string): Promise<FLoaded> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Unknown game');
  const got = await store.load(id);
  if (!got || !got.room) throw new HttpError(404, 'That game no longer exists');
  if (!got.room.members.includes(uid) && seatOf(got.room, uid) < 0) throw new HttpError(403, 'You are not in this game');
  return got;
}

export async function handle(req: FPlayRequest, uid: string, store: FStore): Promise<FPlayReply> {
  if (!req || typeof req !== 'object') throw new HttpError(400, 'Bad request');
  for (let attempt = 0; attempt < 4; attempt++) {
    const l = await loadRoom(store, req.room, uid);
    const out = await step(req, uid, store, l);
    if (out) return out;
  }
  throw new HttpError(409, 'The game is busy; try again');
}

async function step(req: FPlayRequest, uid: string, store: FStore, l: FLoaded): Promise<FPlayReply | null> {
  const { room } = l;
  const seat = seatOf(room, uid);
  switch (req.op) {
    case 'view':
      return reply(room, l.state, uid);

    case 'start': {
      if (room.host !== uid) throw new HttpError(403, 'Only the host can start the game');
      if (room.status !== 'lobby' || l.state) return reply(room, l.state, uid);
      const open = room.seats.filter((x) => x.kind === 'open').length;
      if (open) throw new HttpError(409, `Waiting for ${open} more player${open === 1 ? '' : 's'} to join`);
      const s = createGame(room.seats.map((x) => ({ name: x.name, color: x.color, cpu: x.kind === 'human' ? null : (x.kind as Level) })), { variable: room.settings?.variable === true });
      const saved = await commit(store, l, patchFor(s, []), uid);
      return saved ? reply(saved, s, uid) : null;
    }

    case 'act': {
      if (!l.state || room.status !== 'playing') throw new HttpError(409, 'This game is not being played');
      if (seat < 0) throw new HttpError(403, 'You are watching this game');
      const a = req.action;
      if (!a || typeof a !== 'object' || typeof (a as { t?: unknown }).t !== 'string') throw new HttpError(400, 'Bad action');
      const s = structuredClone(l.state);
      const me = s.players[seat];
      if (me.forfeited) throw new HttpError(409, 'You forfeited this game');
      if (me.cpu) throw new HttpError(409, 'A CPU is playing your seat');
      if (decider(s) !== seat) throw new HttpError(409, 'It’s not your turn');
      try { applyActionMut(s, a); } catch (e) { throw new HttpError(422, (e as Error).message); }
      const saved = await commit(store, l, patchFor(s, [{ seat, a }]), uid);
      return saved ? reply(saved, s, uid) : null;
    }

    case 'advance': {
      // anyone in the room may ask for the next CPU step; stale requests do nothing
      if (!l.state || room.status !== 'playing' || req.version !== room.version) return reply(room, l.state, uid);
      const s = structuredClone(l.state);
      const d = decider(s);
      if (!s.players[d].cpu) return reply(room, l.state, uid);
      const log: FSavePatch['actions'] = [];
      // a CPU's own follow-up choices (where the egg goes…) come with its move
      for (let guard = 0; guard < 30; guard++) {
        const a = cpuAction(s, s.players[d].cpu!);
        applyActionMut(s, a);
        log.push({ seat: d, a });
        if (s.phase === 'over' || !s.prompt || decider(s) !== d) break;
      }
      const saved = await commit(store, l, patchFor(s, log), uid);
      return saved ? reply(saved, s, uid) : reply(room, l.state, uid);
    }

    case 'seat': {
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
      const saved = await commit(store, l, patchFor(s, [], seats), uid);
      return saved ? reply(saved, s, uid) : null;
    }

    case 'forfeit': {
      if (!l.state || room.status !== 'playing') throw new HttpError(409, 'This game is not being played');
      if (seat < 0) throw new HttpError(403, 'You are watching this game');
      if (room.seats[seat].forfeited || l.state.players[seat].forfeited) throw new HttpError(409, 'You already forfeited');
      const s = structuredClone(l.state);
      try { forfeitMut(s, seat); } catch (e) { throw new HttpError(422, (e as Error).message); }
      const kind = s.players[seat].cpu ?? 'normal';
      const seats = room.seats.map((x, j) => (j === seat ? { ...x, kind, forfeited: true } : x));
      const saved = await commit(store, l, patchFor(s, [{ seat, a: { t: 'forfeit' } }], seats), uid);
      return saved ? reply(saved, s, uid) : null;
    }

    default:
      throw new HttpError(400, 'Unknown request');
  }
}
