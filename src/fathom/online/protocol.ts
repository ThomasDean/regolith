// Shapes shared by Fathom's online client and its referee (the fathom-play Edge Function).
import type { FAction, FState, Level } from '../engine/types';
import type { BaseRoom } from '../../shell/rooms';

export type SeatKind = 'human' | 'open' | Level;
export interface SeatRow { kind: SeatKind; name: string; color: string; user: string | null; forfeited?: boolean }
export interface FRoomSettings { variable?: boolean }

export interface FRoomRow extends BaseRoom {
  seats: SeatRow[];
  settings?: FRoomSettings;
  phase: string | null;
  tide: number | null;
  created_at?: string;
}

export type FPlayRequest =
  | { op: 'view'; room: string }
  | { op: 'start'; room: string }
  | { op: 'act'; room: string; action: FAction }
  | { op: 'advance'; room: string; version: number }
  | { op: 'seat'; room: string; seat: number; kind: 'human' | Level }
  | { op: 'forfeit'; room: string };

export interface FPlayReply {
  room: FRoomRow;
  /** your seat, or -1 when you're watching */
  seat: number;
  /** the game without the deck order or the random seed (hands are open in Fathom) */
  view: FState | null;
}

export const HIDDEN = '?';
