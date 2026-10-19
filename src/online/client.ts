// Browser side of online play: lobby calls go straight to the database functions; game moves
// go to the regolith-play Edge Function, which answers with your own view of the game.
import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { cloudEnabled, sb } from '../cloud';
import type { PlayReply, PlayRequest, RoomRow, SeatKind } from './protocol';

export const onlineEnabled = cloudEnabled;

export interface SeatDraft { kind: SeatKind; name: string; color: string; user?: string | null }

const db = () => sb().schema('regolith');

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendly(error.message));
  return data;
}

function friendly(msg: string): string {
  if (/anonymous sign-ins are disabled/i.test(msg)) return 'Guest play isn’t switched on for this site yet. Sign in with your email above instead.';
  if (/schema must be one of/i.test(msg)) return 'Online play isn’t set up on the server yet.';
  if (/function .* does not exist|Could not find the function/i.test(msg)) return 'Online play isn’t set up on the server yet.';
  return msg;
}

export async function signInGuest() {
  const { error } = await sb().auth.signInAnonymously();
  if (error) throw new Error(friendly(error.message));
}

export async function createRoom(seats: SeatDraft[], corporateEra: boolean): Promise<{ id: string; code: string }> {
  return must(db().rpc('create_room', { p_seats: seats, p_corporate_era: corporateEra }));
}

export async function updateRoom(id: string, seats: SeatDraft[], corporateEra: boolean) {
  await must(db().rpc('update_room', { p_room: id, p_seats: seats, p_corporate_era: corporateEra }));
}

export async function joinRoom(code: string, name: string): Promise<string> {
  return must(db().rpc('join_room', { p_code: code, p_name: name }));
}

export async function leaveRoom(id: string) {
  await must(db().rpc('leave_room', { p_room: id }));
}

export async function myRooms(): Promise<RoomRow[]> {
  return must(db().from('rooms').select('*').order('updated_at', { ascending: false }).limit(30)) as Promise<RoomRow[]>;
}

export async function fetchRoom(id: string): Promise<RoomRow | null> {
  const rows = (await must(db().from('rooms').select('*').eq('id', id).limit(1))) as RoomRow[];
  return rows[0] ?? null;
}

export async function play(req: PlayRequest): Promise<PlayReply> {
  const { data, error } = await sb().functions.invoke('regolith-play', { body: req });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = ((await error.context.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
      if (error.context.status === 404 && /not found/i.test(msg)) msg = 'Online play isn’t set up on the server yet.';
    }
    throw new Error(friendly(msg));
  }
  return data as PlayReply;
}

/**
 * Follows a room row: realtime pushes changes as they happen, and a slow poll catches anything
 * realtime missed (a sleeping phone, a dropped socket). Calls back with each newer version.
 */
export function watchRoom(id: string, onRow: (r: RoomRow) => void, onGone?: () => void): () => void {
  let last = -1;
  let live = false;
  let stopped = false;
  const offer = (r: RoomRow | null) => {
    if (stopped) return;
    if (!r) { onGone?.(); return; }
    if (r.version > last) { last = r.version; onRow(r); }
  };
  const poll = () => fetchRoom(id).then(offer, () => { /* try again next tick */ });
  poll();
  const ch = sb().channel(`regolith-room-${id}`)
    .on('postgres_changes', { event: '*', schema: 'regolith', table: 'rooms', filter: `id=eq.${id}` }, (payload) => {
      if (payload.eventType === 'DELETE') offer(null);
      else offer(payload.new as RoomRow);
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
export function useRoom(id: string): RoomRow | null | undefined {
  const [row, setRow] = useState<RoomRow | null | undefined>(undefined);
  useEffect(() => {
    setRow(undefined);
    return watchRoom(id, setRow, () => setRow(null));
  }, [id]);
  return row;
}

// The name you play under and the room you were last in, kept on this device.
const NAME_KEY = 'regolith-online-name';
const ROOM_KEY = 'regolith-online-room';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
export const savedName = () => get(NAME_KEY) ?? '';
export const saveName = (n: string) => set(NAME_KEY, n);
export const lastRoom = () => get(ROOM_KEY);
export const setLastRoom = (id: string | null) => set(ROOM_KEY, id);

/** Link a friend can open to join: the site with ?join=CODE. */
export const joinLink = (code: string) => `${window.location.origin}${window.location.pathname}?join=${code}`;
export const joinCodeFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get('join')?.toUpperCase() ?? null; } catch { return null; }
};
