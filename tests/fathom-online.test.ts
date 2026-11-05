import { describe, expect, it } from 'vitest';
import { handle, noticesFor, type FLoaded, type FSavePatch, type FStore, type Notice } from '../src/fathom/online/referee';
import { HIDDEN, type FPlayReply, type FRoomRow, type SeatRow } from '../src/fathom/online/protocol';
import { candidateActions } from '../src/fathom/engine/cpu';
import type { FAction, FState } from '../src/fathom/engine/types';

class MemStore implements FStore {
  room!: FRoomRow;
  state: FState | null = null;
  notices: Notice[] = [];
  notify(n: Notice) { this.notices.push(n); }
  async load(id: string): Promise<FLoaded | null> {
    return id === this.room.id ? structuredClone({ room: this.room, state: this.state }) : null;
  }
  async save(_id: string, version: number, p: FSavePatch) {
    if (this.room.version !== version) return null;
    this.room = { ...this.room, version: version + 1, status: p.status, phase: p.phase, tide: p.tide, decider: p.decider, waiting: p.waiting, seats: p.seats ?? this.room.seats };
    this.state = structuredClone(p.state);
    return version + 1;
  }
}

const ID = '00000000-0000-4000-8000-0000000000f1';
const human = (i: number): SeatRow => ({ kind: 'human', name: `H${i}`, color: '#fff', user: `u${i}` });
const cpu = (i: number): SeatRow => ({ kind: 'normal', name: `C${i}`, color: '#000', user: null });

function makeStore(seats: SeatRow[], variable = false) {
  const store = new MemStore();
  const members = seats.flatMap((x) => (x.user ? [x.user] : []));
  store.room = { id: ID, code: 'FSH234', host: members[0], status: 'lobby', seats, members, settings: { variable }, version: 0, phase: null, tide: null, decider: null, waiting: [], updated_at: '' };
  return store;
}

describe('online Fathom referee', () => {
  it('only the host starts, once every seat is filled, with the room’s goals', async () => {
    const store = makeStore([human(0), { kind: 'open', name: '', color: '#f00', user: null }], true);
    await expect(handle({ op: 'start', room: ID }, 'u0', store)).rejects.toThrow(/Waiting for 1 more/);
    store.room.seats[1] = human(1);
    store.room.members.push('u1');
    await expect(handle({ op: 'start', room: ID }, 'u1', store)).rejects.toThrow(/Only the host/);
    const r = await handle({ op: 'start', room: ID }, 'u0', store);
    expect(r.room.status).toBe('playing');
    expect(r.view!.options.variable).toBe(true);
    expect(r.view!.deck.every((c) => c === HIDDEN)).toBe(true);
    expect(r.view!.rng).toBe(0);
    expect(JSON.stringify(r.view)).not.toContain(String(store.state!.options.seed));
    // hands are open
    expect(r.view!.players[1].hand).toEqual(store.state!.players[1].hand);
  });

  it('rejects moves out of turn, by outsiders and illegal ones', async () => {
    const store = makeStore([human(0), human(1)]);
    await handle({ op: 'start', room: ID }, 'u0', store);
    const s = store.state!;
    const waiting = `u${s.active}`, other = `u${1 - s.active}`;
    await expect(handle({ op: 'act', room: ID, action: { t: 'dive', col: 0 } }, other, store)).rejects.toThrow(/not your turn/);
    await expect(handle({ op: 'view', room: ID }, 'stranger', store)).rejects.toThrow(/not in this game/);
    await expect(handle({ op: 'act', room: ID, action: { t: 'dive', col: 7 } }, waiting, store)).rejects.toThrow(/No such dive site/);
    const r = await handle({ op: 'act', room: ID, action: { t: 'dive', col: 0 } }, waiting, store);
    expect(r.room.version).toBe(2);
  });

  it('plays whole games: two humans moving from their own views, and CPUs stepped on request', async () => {
    for (const seed of [1, 2, 3]) {
      const store = makeStore([human(0), cpu(1), human(2)]);
      let r: FPlayReply = await handle({ op: 'start', room: ID }, 'u0', store);
      let x = seed * 7919;
      const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      for (let guard = 0; guard < 3000 && r.room.status !== 'over'; guard++) {
        const v = r.view!;
        const d = v.prompt ? v.prompt.pid : v.active;
        if (v.players[d].cpu) { r = await handle({ op: 'advance', room: ID, version: r.room.version }, 'u2', store); continue; }
        const uid = `u${d}`;
        let a: FAction;
        if (v.prompt) a = { t: 'answer', choice: rnd() < 0.2 ? null : Math.floor(rnd() * v.prompt.options.length) };
        else { const c = candidateActions(v, d); a = c[Math.floor(rnd() * c.length)]; }
        r = await handle({ op: 'act', room: ID, action: a }, uid, store);
      }
      expect(r.room.status).toBe('over');
      expect(r.room.waiting).toEqual([]);
    }
  }, 120_000);

  it('ignores a stale advance', async () => {
    const store = makeStore([human(0), cpu(1)]);
    const r = await handle({ op: 'start', room: ID }, 'u0', store);
    const before = store.room.version;
    await handle({ op: 'advance', room: ID, version: r.room.version - 1 }, 'u0', store);
    expect(store.room.version).toBe(before);
  });

  it('lets the host hand a seat to a CPU and back, and a player forfeit for good', async () => {
    const store = makeStore([human(0), human(1), human(2)]);
    await handle({ op: 'start', room: ID }, 'u0', store);
    await expect(handle({ op: 'seat', room: ID, seat: 1, kind: 'hard' }, 'u1', store)).rejects.toThrow(/Only the host/);
    expect((await handle({ op: 'seat', room: ID, seat: 1, kind: 'hard' }, 'u0', store)).room.seats[1].kind).toBe('hard');
    expect((await handle({ op: 'seat', room: ID, seat: 1, kind: 'human' }, 'u0', store)).room.seats[1].kind).toBe('human');
    const f = await handle({ op: 'forfeit', room: ID }, 'u2', store);
    expect(f.room.seats[2]).toMatchObject({ kind: 'normal', forfeited: true });
    await expect(handle({ op: 'seat', room: ID, seat: 2, kind: 'human' }, 'u0', store)).rejects.toThrow(/forfeited/);
    await expect(handle({ op: 'forfeit', room: ID }, 'u2', store)).rejects.toThrow(/already forfeited/);
    const end = await handle({ op: 'forfeit', room: ID }, 'u1', store);
    expect(end.room.status).toBe('over');
    expect(end.view!.endedBy).toBe('forfeit');
  });
});

describe('Fathom push notices', () => {
  const room = (waiting: number[], status: FRoomRow['status'] = 'playing'): FRoomRow => ({
    id: ID, code: 'FSH234', host: 'u0', status, seats: [human(0), human(1), cpu(2)], members: ['u0', 'u1'], version: 3, phase: 'play', tide: 1, decider: waiting[0] ?? null, waiting, updated_at: '',
  });
  const patch = (waiting: number[], status: FRoomRow['status'] = 'playing'): FSavePatch => ({ state: {} as FState, actions: [], status, phase: 'play', tide: 2, decider: waiting[0] ?? null, waiting, seats: null });

  it('tells a human when their turn comes, with a link into Fathom, but not the mover', () => {
    const n = noticesFor(room([0]), patch([1]), 'u0')!;
    expect(n).toMatchObject({ users: ['u1'], title: 'Fathom: your turn', url: `/fathom?room=${ID}` });
    expect(n.body).toContain('Tide 2');
    expect(noticesFor(room([0]), patch([2]), 'u0')).toBeNull(); // a CPU is next
  });

  it('says the game is over to every human but the last mover', () => {
    expect(noticesFor(room([0]), patch([], 'over'), 'u0')).toMatchObject({ users: ['u1'], title: 'Fathom: game over' });
  });
});
