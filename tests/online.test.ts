import { describe, it, expect } from 'vitest';
import { handle, HttpError, viewFor, type Loaded, type SavePatch, type Store } from '../src/online/referee';
import { HIDDEN, type PlayReply, type RoomRow, type SeatRow } from '../src/online/protocol';
import { randomAction } from '../src/engine/bot';
import { createGame } from '../src/engine/game';
import type { Action, GameState } from '../src/engine/types';

function rng(seed: number) { let t = seed; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

/** In-memory stand-in for the two Supabase tables, with the same version check. */
class MemStore implements Store {
  rooms = new Map<string, { room: RoomRow; state: GameState | null; pending: Record<string, Action>; actions: unknown[] }>();
  saves = 0;
  async load(id: string): Promise<Loaded | null> {
    const r = this.rooms.get(id);
    return r ? structuredClone({ room: r.room, state: r.state, pending: r.pending }) : null;
  }
  async save(id: string, version: number, p: SavePatch) {
    const r = this.rooms.get(id)!;
    if (r.room.version !== version) return null;
    this.saves++;
    r.room = { ...r.room, version: version + 1, status: p.status, phase: p.phase, generation: p.generation, decider: p.decider, waiting: p.waiting, seats: p.seats ?? r.room.seats };
    r.state = structuredClone(p.state);
    r.pending = structuredClone(p.pending);
    r.actions.push(...p.actions);
    return version + 1;
  }
}

const ID = '00000000-0000-4000-8000-000000000001';
function makeRoom(store: MemStore, seats: SeatRow[]) {
  const members = seats.flatMap((x) => (x.user ? [x.user] : []));
  store.rooms.set(ID, {
    room: { id: ID, code: 'ABC234', host: members[0], status: 'lobby', seats, members, corporate_era: true, version: 0, phase: null, generation: null, decider: null, waiting: [], updated_at: '' },
    state: null, pending: {}, actions: [],
  });
}

const human = (i: number): SeatRow => ({ kind: 'human', name: `H${i}`, color: '#fff', user: `u${i}` });
const cpu = (i: number, kind: 'easy' | 'normal' | 'hard' = 'easy'): SeatRow => ({ kind, name: `C${i}`, color: '#000', user: null });

function expectPrivate(r: PlayReply) {
  const v = r.view!;
  expect(v.rng).toBe(0);
  expect(v.options.seed).toBe(0);
  expect(v.deck.every((c) => c === HIDDEN)).toBe(true);
  for (const p of v.players) {
    if (p.id === r.seat) continue;
    expect(p.hand.every((c) => c === HIDDEN)).toBe(true);
    if (p.research) expect(p.research.every((c) => c === HIDDEN)).toBe(true);
    if (p.setup) expect(p.setup.cards.every((c) => c === HIDDEN)).toBe(true);
  }
}

describe('online referee', () => {
  it('hides other hands, the deck and the RNG', () => {
    const s = createGame([{ name: 'a', color: '', cpu: null }, { name: 'b', color: '', cpu: null }], { seed: 987654321 });
    const v = viewFor(s, 0);
    expect(v.players[0].setup!.cards).toEqual(s.players[0].setup!.cards);
    expect(v.players[1].setup!.cards.every((c) => c === HIDDEN)).toBe(true);
    expect(v.deck.length).toBe(s.deck.length);
    expect(JSON.stringify(v)).not.toContain(String(s.options.seed));
  });

  it('only the host starts, only once every seat is filled', async () => {
    const store = new MemStore();
    makeRoom(store, [human(0), { kind: 'open', name: '', color: '', user: null }]);
    await expect(handle({ op: 'start', room: ID }, 'u0', store)).rejects.toThrow(/Waiting for 1 more player/);
    store.rooms.get(ID)!.room.seats[1] = human(1);
    store.rooms.get(ID)!.room.members.push('u1');
    await expect(handle({ op: 'start', room: ID }, 'u1', store)).rejects.toThrow(/Only the host/);
    await expect(handle({ op: 'view', room: ID }, 'stranger', store)).rejects.toBeInstanceOf(HttpError);
    const r = await handle({ op: 'start', room: ID }, 'u0', store);
    expect(r.room.status).toBe('playing');
    expect(r.room.waiting.sort()).toEqual([0, 1]);
  });

  it('rejects moves out of turn and illegal moves', async () => {
    const store = new MemStore();
    makeRoom(store, [human(0), human(1)]);
    const r0 = await handle({ op: 'start', room: ID }, 'u0', store);
    const other = r0.room.decider === 0 ? 1 : 0;
    const bad: Action = { t: 'setup', corp: 'not-a-corp', keep: [] };
    await expect(handle({ op: 'act', room: ID, action: bad }, `u${r0.room.decider}`, store)).rejects.toThrow(/not offered/);
    await expect(handle({ op: 'act', room: ID, action: { t: 'pass' } }, `u${other}`, store)).rejects.toThrow(/not your turn/);
  });

  for (const [g, seats] of [
    [0, [human(0), cpu(1, 'normal'), human(2)]],
    [1, [human(0), human(1)]],
    [2, [cpu(0, 'hard'), human(1), cpu(2), human(3)]],
  ] as const) {
    it(`plays a whole online game ${g} from redacted views`, async () => {
      const store = new MemStore();
      makeRoom(store, seats.map((x) => ({ ...x })));
      const r = rng(100 + g);
      let last = await handle({ op: 'start', room: ID }, seats.find((x) => x.user)!.user!, store);
      const humans = seats.flatMap((x, i) => (x.user ? [i] : []));
      for (let step = 0; step < 30000 && last.room.status !== 'over'; step++) {
        const room = last.room;
        const d = room.decider!;
        if (seats[d].kind !== 'human') {
          last = await handle({ op: 'advance', room: ID, version: room.version }, 'u' + humans[step % humans.length], store);
          continue;
        }
        // every waiting human may submit a simultaneous pick early; the decider must act
        const who = room.waiting.filter((i) => humans.includes(i));
        const seat = who.includes(d) ? d : who[Math.floor(r() * who.length)] ?? d;
        const mine = await handle({ op: 'view', room: ID }, `u${seat}`, store);
        expectPrivate(mine);
        const v = structuredClone(mine.view!);
        if (seat !== d) v.active = seat;
        last = await handle({ op: 'act', room: ID, action: randomAction(v, r) }, `u${seat}`, store);
      }
      expect(last.room.status).toBe('over');
      expect(store.rooms.get(ID)!.state!.phase).toBe('over');
    }, 120000);
  }

  it('lets the host hand a seat to a CPU and back', async () => {
    const store = new MemStore();
    makeRoom(store, [human(0), human(1)]);
    await handle({ op: 'start', room: ID }, 'u0', store);
    await expect(handle({ op: 'seat', room: ID, seat: 1, kind: 'hard' }, 'u1', store)).rejects.toThrow(/Only the host/);
    const r = await handle({ op: 'seat', room: ID, seat: 1, kind: 'hard' }, 'u0', store);
    expect(r.room.seats[1].kind).toBe('hard');
    expect(store.rooms.get(ID)!.state!.players[1].cpu).toBe('hard');
    await expect(handle({ op: 'act', room: ID, action: { t: 'pass' } }, 'u1', store)).rejects.toThrow(/CPU is playing your seat/);
    const back = await handle({ op: 'seat', room: ID, seat: 1, kind: 'human' }, 'u0', store);
    expect(back.room.seats[1].kind).toBe('human');
  });

  it('ignores a stale advance', async () => {
    const store = new MemStore();
    makeRoom(store, [human(0), cpu(1)]);
    const r = await handle({ op: 'start', room: ID }, 'u0', store);
    const before = store.saves;
    await handle({ op: 'advance', room: ID, version: r.room.version - 1 }, 'u0', store);
    expect(store.saves).toBe(before);
  });
});
