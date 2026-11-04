// Development only (open the dev server at /fathom#online-sim): runs the real Fathom referee in
// the browser with an in-memory store, so the online game screen can be tried without Supabase.
// Two human seats share this tab; switch between them with the bar at the top.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FAction, FState, Level } from '../engine/types';
import { handle, type FLoaded, type FSavePatch, type FStore } from '../online/referee';
import type { FPlayReply, FPlayRequest, FRoomRow } from '../online/protocol';
import { PLAYER_COLORS } from '../../ui/format';
import { FathomGame, type FathomOnline } from './FathomApp';

const ROOM = '00000000-0000-4000-8000-0000000f517e';

class MemStore implements FStore {
  room: FRoomRow;
  state: FState | null = null;
  listeners = new Set<() => void>();
  constructor(room: FRoomRow) { this.room = room; }
  async load(): Promise<FLoaded> { return structuredClone({ room: this.room, state: this.state }); }
  async save(_id: string, version: number, p: FSavePatch) {
    if (version !== this.room.version) return null;
    this.room = { ...this.room, version: version + 1, status: p.status, phase: p.phase, tide: p.tide, decider: p.decider, waiting: p.waiting, seats: p.seats ?? this.room.seats };
    this.state = structuredClone(p.state);
    setTimeout(() => this.listeners.forEach((f) => f()), 30);
    return this.room.version;
  }
}

const makeStore = () => new MemStore({
  id: ROOM, code: 'SIM567', host: 'u0', status: 'lobby', members: ['u0', 'u1'], settings: { variable: true }, version: 0,
  phase: null, tide: null, decider: null, waiting: [], updated_at: new Date().toISOString(),
  seats: [
    { kind: 'human', name: 'Tom', color: PLAYER_COLORS[0], user: 'u0' },
    { kind: 'human', name: 'Ana', color: PLAYER_COLORS[1], user: 'u1' },
    { kind: 'normal', name: 'Marina', color: PLAYER_COLORS[2], user: null },
  ],
});

function Seat({ store, uid, visible }: { store: MemStore; uid: string; visible: boolean }) {
  const [reply, setReply] = useState<FPlayReply | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef(-1);
  const call = useCallback(async (req: FPlayRequest) => {
    const r = await handle(req, uid, store);
    if (r.room.version >= latest.current) { latest.current = r.room.version; setReply(r); }
  }, [store, uid]);
  useEffect(() => {
    const pull = () => { if (store.room.version > latest.current) call({ op: 'view', room: ROOM }).catch((e) => setErr(String(e))); };
    store.listeners.add(pull);
    pull();
    return () => { store.listeners.delete(pull); };
  }, [store, call]);
  const link = useMemo<FathomOnline | null>(() => reply?.view ? {
    room: ROOM, code: reply.room.code, seat: reply.seat, host: reply.room.host === uid, version: reply.room.version, view: reply.view,
    seats: reply.room.seats, waiting: reply.room.waiting,
    send: (a: FAction) => call({ op: 'act', room: ROOM, action: a }),
    advance: (version: number) => { call({ op: 'advance', room: ROOM, version }).catch((e) => setErr(String(e))); },
    setSeat: (seat: number, kind: 'human' | Level) => call({ op: 'seat', room: ROOM, seat, kind }),
    forfeit: () => call({ op: 'forfeit', room: ROOM }),
  } : null, [reply, uid, call]);
  return (
    <div style={{ display: visible ? 'block' : 'none' }} data-seat={uid}>
      {err && <p className="warn">{err}</p>}
      {link ? <FathomGame id={ROOM} initial={link.view} online={link} /> : <p className="pad muted">Waiting…</p>}
    </div>
  );
}

export function FathomOnlineSim() {
  const store = useMemo(makeStore, []);
  const [as, setAs] = useState('u0');
  const [started, setStarted] = useState(false);
  useEffect(() => { handle({ op: 'start', room: ROOM }, 'u0', store).then(() => setStarted(true)); }, [store]);
  if (!started) return <p className="pad muted">Starting…</p>;
  return (
    <div className="fathom">
      <div className="sim-bar" role="toolbar" aria-label="Simulated players">
        <span className="muted">Online simulation · view as</span>
        {store.room.seats.filter((x) => x.user).map((x) => (
          <button key={x.user} type="button" className={`btn small${as === x.user ? '' : ' ghost'}`} onClick={() => setAs(x.user!)}>{x.name}</button>
        ))}
      </div>
      <Seat store={store} uid="u0" visible={as === 'u0'} />
      <Seat store={store} uid="u1" visible={as === 'u1'} />
    </div>
  );
}
