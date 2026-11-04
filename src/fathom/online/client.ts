// Browser side of online Fathom: lobby calls go to the fathom schema's functions, moves to the
// fathom-play Edge Function, which answers with the game as you may see it.
import { sb } from '../../cloud';
import { must, roomsClient } from '../../shell/rooms';
import type { FPlayReply, FPlayRequest, FRoomRow, FRoomSettings, SeatKind } from './protocol';

export interface FSeatDraft { kind: SeatKind; name: string; color: string; user?: string | null }

const rooms = roomsClient<FRoomRow>('fathom', 'fathom-play');
const db = () => sb().schema('fathom');

export async function createFathomRoom(seats: FSeatDraft[], settings: FRoomSettings): Promise<{ id: string; code: string }> {
  return must(db().rpc('create_room', { p_seats: seats, p_settings: settings }));
}
export async function updateFathomRoom(id: string, seats: FSeatDraft[], settings?: FRoomSettings) {
  await must(db().rpc('update_room', { p_room: id, p_seats: seats, ...(settings ? { p_settings: settings } : {}) }));
}

export const fathomRooms = rooms;
export const playFathom = (req: FPlayRequest) => rooms.play<FPlayRequest, FPlayReply>(req);

/** Link a friend can open to join. */
export const fathomJoinLink = (code: string) => `${window.location.origin}/fathom?join=${code}`;
