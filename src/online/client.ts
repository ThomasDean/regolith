// Browser side of online play: lobby calls go straight to the database functions; game moves
// go to the regolith-play Edge Function, which answers with your own view of the game.
import { sb } from '../cloud';
import { must, onlineEnabled as enabled, roomsClient, signInGuest as guest } from '../shell/rooms';
import type { PlayReply, PlayRequest, RoomRow, RoomSettings, SeatKind } from './protocol';

export const onlineEnabled = enabled;
export const signInGuest = guest;

export interface SeatDraft { kind: SeatKind; name: string; color: string; user?: string | null }

const rooms = roomsClient<RoomRow>('regolith', 'regolith-play');
const db = () => sb().schema('regolith');

export async function createRoom(seats: SeatDraft[], corporateEra: boolean, settings?: RoomSettings): Promise<{ id: string; code: string }> {
  return must(db().rpc('create_room', { p_seats: seats, p_corporate_era: corporateEra, ...(settings ? { p_settings: settings } : {}) }));
}

/** Seats and options; settings left out keep what the room has. */
export async function updateRoom(id: string, seats: SeatDraft[], corporateEra: boolean, settings?: RoomSettings) {
  await must(db().rpc('update_room', { p_room: id, p_seats: seats, p_corporate_era: corporateEra, ...(settings ? { p_settings: settings } : {}) }));
}

export const { joinRoom, leaveRoom, myRooms, fetchRoom, watchRoom, useRoom } = rooms;
export const play = (req: PlayRequest) => rooms.play<PlayRequest, PlayReply>(req);

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
