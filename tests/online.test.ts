import { describe, it, expect } from 'vitest';
import { handle, HttpError, noticesFor, viewFor, type Loaded, type Notice, type SavePatch, type Store } from '../src/online/referee';
import { HIDDEN, type PlayReply, type RoomRow, type SeatRow } from '../src/online/protocol';
import { randomAction } from '../src/engine/bot';
import { createGame } from '../src/engine/game';
import type { Action, GameState } from '../src/engine/types';

function rng(seed: number) { let t = seed; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

/** In-memory stand-in for the two Supabase tables, with the same version check. */
class MemStore implements Store {
  rooms = new Map<string, { room: RoomRow; state: GameState | null; pending: Record<string, Action>; actions: unknown[] }>();
  saves = 0;
  notices: Notice[] = [];
  notify(n: Notice) { this.notices.push(structuredClone(n)); }
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
    if (p.setup?.preludes) expect(p.setup.preludes.every((c) => c === HIDDEN)).toBe(true);
    if (p.preludes) expect(p.preludes.every((c) => c === HIDDEN)).toBe(true);
  }
  if (v.preludeDeck) expect(v.preludeDeck.every((c) => c === HIDDEN)).toBe(true);
  if (v.turmoil) expect(v.turmoil.deck.every((c) => c === HIDDEN)).toBe(true);
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

  it('starts the game on the room’s map with its milestones and awards', async () => {
    const store = new MemStore();
    makeRoom(store, [human(0), cpu(1)]);
    const ms = ['mayor', 'builder', 'planner', 'gardener', 'legend'], aw = ['banker', 'miner', 'magnate', 'celebrity', 'investor'];
    store.rooms.get(ID)!.room.settings = { board: 'elysium', milestones: ms, awards: aw };
    const r = await handle({ op: 'start', room: ID }, 'u0', store);
    expect(r.view!.options).toMatchObject({ board: 'elysium', milestones: ms, awards: aw });
    expect(r.view!.board.find((x) => x.id === '20')!.name).toBe('Olympus Mons');
    const bad = new MemStore();
    makeRoom(bad, [human(0), cpu(1)]);
    bad.rooms.get(ID)!.room.settings = { board: 'hellas', milestones: ['geologist', 'builder', 'planner', 'gardener', 'legend'] };
    await expect(handle({ op: 'start', room: ID }, 'u0', bad)).rejects.toThrow(/milestones/);
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

  it('starts with the room’s expansions', async () => {
    const store = new MemStore();
    makeRoom(store, [human(0), cpu(1)]);
    store.rooms.get(ID)!.room.settings = { board: 'tharsis', expansions: { prelude: true, venus: true, colonies: true, turmoil: true } };
    const r = await handle({ op: 'start', room: ID }, 'u0', store);
    expect(r.view!.options.expansions).toEqual({ prelude: true, venus: true, colonies: true, turmoil: true });
    expect(r.view!.venus).toBe(0);
    expect(r.view!.colonies!.length).toBe(5);
    expect(r.view!.players[0].setup!.preludes).toHaveLength(4);
    expect(r.view!.players[1].setup!.preludes!.every((c) => c === HIDDEN)).toBe(true);
  });

  for (const [g, seats, expansions] of [
    [0, [human(0), cpu(1, 'normal'), human(2)], undefined],
    [1, [human(0), human(1)], undefined],
    [2, [cpu(0, 'hard'), human(1), cpu(2), human(3)], undefined],
    [3, [human(0), cpu(1, 'normal'), human(2)], { prelude: true, venus: true, colonies: true, turmoil: true }],
  ] as const) {
    it(`plays a whole online game ${g} from redacted views${expansions ? ' with all expansions' : ''}`, async () => {
      const store = new MemStore();
      makeRoom(store, seats.map((x) => ({ ...x })));
      if (expansions) store.rooms.get(ID)!.room.settings = { expansions: { ...expansions } };
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

describe('push notices', () => {
  const room = (seats: SeatRow[], over: Partial<RoomRow> = {}): RoomRow => ({
    id: ID, code: 'ABC234', host: 'u0', status: 'playing', seats, members: seats.flatMap((x) => (x.user ? [x.user] : [])), corporate_era: true,
    version: 3, phase: 'action', generation: 4, decider: 0, waiting: [0], updated_at: '', ...over,
  });
  const patch = (over: Partial<SavePatch>): SavePatch => ({
    state: {} as GameState, pending: {}, actions: [], status: 'playing', phase: 'action', generation: 4, decider: 1, waiting: [1], seats: null, ...over,
  });

  it('tells a player when their turn comes, naming who they are playing with, but not the one who just moved', () => {
    const r = room([human(0), human(1), cpu(2)]);
    expect(noticesFor(r, patch({}), 'u0')).toEqual({ room: ID, users: ['u1'], title: 'Your turn', body: 'Generation 4 · with H0 and C2', tag: ID });
    expect(noticesFor(r, patch({}), 'u1')).toBeNull(); // they moved themselves (e.g. a CPU step they asked for)
  });

  it('stays quiet while the same player keeps deciding, and when a CPU is next', () => {
    const r = room([human(0), human(1), cpu(2)], { waiting: [1] });
    expect(noticesFor(r, patch({ waiting: [1] }), 'u0')).toBeNull();
    expect(noticesFor(r, patch({ waiting: [2], decider: 2 }), 'u1')).toBeNull();
  });

  it('asks everyone for their picks at once, using the phase for the title', () => {
    const r = room([human(0), human(1), human(2)], { waiting: [1] });
    const n = noticesFor(r, patch({ phase: 'research', waiting: [0, 1, 2], decider: 0 }), 'u1')!;
    expect(n.users.sort()).toEqual(['u0', 'u2']); // seat 1 was already being waited on and made the move
    expect(n.title).toBe('Choose your research cards');
    expect(n.body).toBe('Generation 4');
    expect(noticesFor(room([human(0), human(1)], { status: 'lobby', waiting: [] }), patch({ phase: 'setup', waiting: [0, 1] }), 'u0')!.title).toBe('Choose your corporation');
  });

  it('says the game is over to every human but the last mover, once', () => {
    const r = room([human(0), human(1), cpu(2), human(3)]);
    const over = patch({ status: 'over', phase: 'over', waiting: [], decider: null });
    expect(noticesFor(r, over, 'u1')).toMatchObject({ title: 'Game over', users: ['u0', 'u3'] });
    expect(noticesFor(room([human(0), human(1)], { status: 'over' }), over, 'u1')).toBeNull();
  });

  it('counts a seat handed back to its player as a new turn', () => {
    const seats = [human(0), human(1)];
    const r = room([human(0), { ...human(1), kind: 'hard' }], { waiting: [1] });
    expect(noticesFor(r, patch({ waiting: [1], seats }), 'u0')).toMatchObject({ users: ['u1'] });
    // handing a seat to a CPU tells nobody
    expect(noticesFor(room(seats, { waiting: [1] }), patch({ waiting: [1], seats: [human(0), { ...human(1), kind: 'hard' }] }), 'u0')).toBeNull();
  });

  it('fires from real moves: the start, and then only ever to a human whose move it now is', async () => {
    const store = new MemStore();
    const seats = [human(0), cpu(1, 'normal'), human(2)];
    makeRoom(store, seats.map((x) => ({ ...x })));
    const r = rng(7);
    let last = await handle({ op: 'start', room: ID }, 'u0', store);
    expect(store.notices).toHaveLength(1);
    expect(store.notices[0]).toMatchObject({ users: ['u2'], title: 'Choose your corporation' });
    let seen = 1;
    for (let step = 0; step < 30000 && last.room.status !== 'over'; step++) {
      const d = last.room.decider!;
      const actor = seats[d].kind === 'human' ? `u${d}` : step % 2 ? 'u0' : 'u2';
      if (seats[d].kind !== 'human') last = await handle({ op: 'advance', room: ID, version: last.room.version }, actor, store);
      else {
        const v = structuredClone((await handle({ op: 'view', room: ID }, actor, store)).view!);
        last = await handle({ op: 'act', room: ID, action: randomAction(v, r) }, actor, store);
      }
      for (const n of store.notices.slice(seen)) {
        expect(n.users).not.toContain(actor);
        for (const u of n.users) {
          const i = Number(u.slice(1));
          expect(seats[i].kind).toBe('human');
          if (last.room.status === 'playing') expect(last.room.waiting).toContain(i);
        }
      }
      seen = store.notices.length;
    }
    expect(last.room.status).toBe('over');
    expect(store.notices.filter((n) => n.title === 'Game over')).toHaveLength(1);
    expect(store.notices.length).toBeGreaterThan(5);
  }, 120000);

  it('never lets a failing notification get in the way of a move', async () => {
    for (const notify of [() => { throw new Error('sync boom'); }, () => Promise.reject(new Error('async boom'))]) {
      const store = new MemStore();
      store.notify = notify;
      makeRoom(store, [human(0), human(1)]);
      const r = await handle({ op: 'start', room: ID }, 'u0', store);
      expect(r.room.status).toBe('playing');
      expect(store.rooms.get(ID)!.state).not.toBeNull();
    }
  });
});
