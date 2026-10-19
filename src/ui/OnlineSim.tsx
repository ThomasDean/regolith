// Development only (open the dev server with #online-sim): runs the real online referee in
// the browser with an in-memory store, so the online screens can be tried without Supabase.
// Two human seats share this tab; switch between them with the bar at the top.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameState, Level } from '../engine/types';
import { handle, type Loaded, type SavePatch, type Store } from '../online/referee';
import type { PlayReply, PlayRequest, RoomRow } from '../online/protocol';
import { Game, type OnlineLink } from './Game';
import { PLAYER_COLORS } from './format';

const ROOM = '00000000-0000-4000-8000-00000000517e';

class MemStore implements Store {
  room: RoomRow;
  state: GameState | null = null;
  pending: Record<string, Action> = {};
  listeners = new Set<() => void>();
  constructor(room: RoomRow) { this.room = room; }
  async load(): Promise<Loaded> { return structuredClone({ room: this.room, state: this.state, pending: this.pending }); }
  async save(_id: string, version: number, p: SavePatch) {
    if (version !== this.room.version) return null;
    this.room = { ...this.room, version: version + 1, status: p.status, phase: p.phase, generation: p.generation, decider: p.decider, waiting: p.waiting, seats: p.seats ?? this.room.seats };
    this.state = structuredClone(p.state);
    this.pending = structuredClone(p.pending);
    setTimeout(() => this.listeners.forEach((f) => f()), 30);
    return this.room.version;
  }
}

function makeStore() {
  return new MemStore({
    id: ROOM, code: 'SIM234', host: 'u0', status: 'lobby', members: ['u0', 'u1'], corporate_era: true, version: 0,
    phase: null, generation: null, decider: null, waiting: [], updated_at: new Date().toISOString(),
    seats: [
      { kind: 'human', name: 'Tom', color: PLAYER_COLORS[0], user: 'u0' },
      { kind: 'human', name: 'Ana', color: PLAYER_COLORS[1], user: 'u1' },
      { kind: 'normal', name: 'Vesta', color: PLAYER_COLORS[2], user: null },
    ],
  });
}

function Seat({ store, uid, visible }: { store: MemStore; uid: string; visible: boolean }) {
  const [reply, setReply] = useState<PlayReply | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef(-1);
  const call = useCallback(async (req: PlayRequest) => {
    const r = await handle(req, uid, store);
    if (r.room.version >= latest.current) { latest.current = r.room.version; setReply(r); }
  }, [store, uid]);
  useEffect(() => {
    const pull = () => { if (store.room.version > latest.current) call({ op: 'view', room: ROOM }).catch((e) => setErr(String(e))); };
    store.listeners.add(pull);
    pull();
    return () => { store.listeners.delete(pull); };
  }, [store, call]);
  const link = useMemo<OnlineLink | null>(() => reply?.view ? {
    code: reply.room.code, seat: reply.seat, host: reply.room.host === uid, version: reply.room.version, view: reply.view,
    seats: reply.room.seats, waiting: reply.room.waiting, queued: reply.queued,
    send: (a: Action) => call({ op: 'act', room: ROOM, action: a }),
    advance: (version: number) => { call({ op: 'advance', room: ROOM, version }).catch((e) => setErr(String(e))); },
    setSeat: (seat: number, kind: 'human' | Level) => call({ op: 'seat', room: ROOM, seat, kind }),
  } : null, [reply, uid, call]);
  return (
    <div style={{ display: visible ? 'block' : 'none' }} data-seat={uid}>
      {err && <p className="warn">{err}</p>}
      {link ? <Game initial={link.view} online={link} onExit={() => { location.hash = ''; location.reload(); }} /> : <p className="pad muted">Waiting…</p>}
    </div>
  );
}

export function OnlineSim() {
  const store = useMemo(makeStore, []);
  const [as, setAs] = useState('u0');
  const [started, setStarted] = useState(false);
  useEffect(() => {
    handle({ op: 'start', room: ROOM }, 'u0', store).then(() => setStarted(true));
  }, [store]);
  if (!started) return <p className="pad muted">Starting…</p>;
  return (
    <>
      <div className="sim-bar" role="toolbar" aria-label="Simulated players">
        <span className="muted">Online simulation · view as</span>
        {store.room.seats.filter((x) => x.user).map((x) => (
          <button key={x.user} type="button" className={`btn small${as === x.user ? '' : ' ghost'}`} onClick={() => setAs(x.user!)}>{x.name}</button>
        ))}
      </div>
      <Seat store={store} uid="u0" visible={as === 'u0'} />
      <Seat store={store} uid="u1" visible={as === 'u1'} />
    </>
  );
}
