// Online rooms, for any game: each game keeps its rooms in its own schema and has its own
// referee (Edge Function), but reads, joins, leaves and follows rooms the same way.
import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { cloudEnabled, sb } from '../cloud';

export const onlineEnabled = cloudEnabled;

/** What every game's room row has in common. */
export interface BaseRoom {
  id: string;
  code: string;
  host: string;
  status: 'lobby' | 'playing' | 'over';
  seats: { kind: string; name: string; color: string; user: string | null; forfeited?: boolean }[];
  members: string[];
  version: number;
  decider: number | null;
  waiting: number[];
  updated_at: string;
}

export function friendly(msg: string): string {
  if (/anonymous sign-ins are disabled/i.test(msg)) return 'Guest play isn’t switched on for this site yet. Sign in with Google instead.';
  if (/schema must be one of|Invalid schema/i.test(msg)) return 'Online play isn’t set up on the server yet.';
  if (/function .* does not exist|Could not find the function/i.test(msg)) return 'Online play isn’t set up on the server yet.';
  return msg;
}

export async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendly(error.message));
  return data;
}

export async function signInGuest() {
  const { error } = await sb().auth.signInAnonymously();
  if (error) throw new Error(friendly(error.message));
}

export function roomsClient<R extends BaseRoom>(schema: string, fn: string) {
  const db = () => sb().schema(schema);

  async function myRooms(): Promise<R[]> {
    return must(db().from('rooms').select('*').order('updated_at', { ascending: false }).limit(30)) as Promise<R[]>;
  }
  async function fetchRoom(id: string): Promise<R | null> {
    const rows = (await must(db().from('rooms').select('*').eq('id', id).limit(1))) as R[];
    return rows[0] ?? null;
  }
  async function joinRoom(code: string, name: string): Promise<string> {
    return must(db().rpc('join_room', { p_code: code, p_name: name }));
  }
  async function leaveRoom(id: string) {
    await must(db().rpc('leave_room', { p_room: id }));
  }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return must(db().rpc(name, args)) as Promise<T>;
  }
  async function play<Req, Rep>(req: Req): Promise<Rep> {
    const { data, error } = await sb().functions.invoke(fn, { body: req as object });
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = ((await error.context.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
        if (error.context.status === 404 && /not found/i.test(msg)) msg = 'Online play isn’t set up on the server yet.';
      }
      throw new Error(friendly(msg));
    }
    return data as Rep;
  }

  /**
   * Follows a room row: realtime pushes changes as they happen, and a slow poll catches anything
   * realtime missed (a sleeping phone, a dropped socket). Calls back with each newer version.
   */
  function watchRoom(id: string, onRow: (r: R) => void, onGone?: () => void): () => void {
    let last = -1;
    let live = false;
    let stopped = false;
    const offer = (r: R | null) => {
      if (stopped) return;
      if (!r) { onGone?.(); return; }
      if (r.version > last) { last = r.version; onRow(r); }
    };
    const poll = () => fetchRoom(id).then(offer, () => { /* try again next tick */ });
    poll();
    const ch = sb().channel(`${schema}-room-${id}`)
      .on('postgres_changes', { event: '*', schema, table: 'rooms', filter: `id=eq.${id}` }, (payload) => {
        if (payload.eventType === 'DELETE') offer(null);
        else offer(payload.new as R);
      })
      .subscribe((status) => { live = status === 'SUBSCRIBED'; if (live) poll(); });
    let ticks = 0;
    const timer = setInterval(() => { ticks++; if (!live || ticks % 4 === 0) poll(); }, 4000);
    const wake = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      sb().removeChannel(ch);
    };
  }

  /** The live row for a room: undefined while loading, null if it was closed. */
  function useRoom(id: string): R | null | undefined {
    const [row, setRow] = useState<R | null | undefined>(undefined);
    useEffect(() => {
      setRow(undefined);
      return watchRoom(id, setRow, () => setRow(null));
    }, [id]);
    return row;
  }

  return { myRooms, fetchRoom, joinRoom, leaveRoom, rpc, play, watchRoom, useRoom };
}

/** Your seat in a room, or -1. */
export const mySeat = (r: BaseRoom, uid: string) => r.seats.findIndex((x) => x.user === uid);

/** The room is waiting on you (and you haven't forfeited). */
export function roomWaitsOn(r: BaseRoom, uid: string): boolean {
  const i = mySeat(r, uid);
  return r.status === 'playing' && i >= 0 && !r.seats[i].forfeited && r.waiting.includes(i);
}
