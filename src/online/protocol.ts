// Shapes shared by the online client and the referee (the server that runs the engine).
import type { Action, Expansions, GameState, Level } from '../engine/types';

export type SeatKind = 'human' | 'open' | Level;

export interface SeatRow {
  kind: SeatKind;
  name: string;
  color: string;
  user: string | null;
  /** the player gave up; a CPU plays the seat out and it ranks last */
  forfeited?: boolean;
}

/** Map, milestone/award and expansion choice for an online game (absent: Tharsis with its own set, no expansions). */
export interface RoomSettings { board?: string; milestones?: string[]; awards?: string[]; expansions?: Expansions }

/** The public row every member of a room can read (and gets realtime updates for). */
export interface RoomRow {
  id: string;
  code: string;
  host: string;
  status: 'lobby' | 'playing' | 'over';
  seats: SeatRow[];
  members: string[];
  corporate_era: boolean;
  settings?: RoomSettings;
  version: number;
  phase: string | null;
  generation: number | null;
  decider: number | null;
  waiting: number[];
  created_at?: string;
  updated_at: string;
}

export type PlayRequest =
  | { op: 'view'; room: string }
  | { op: 'start'; room: string }
  | { op: 'act'; room: string; action: Action }
  | { op: 'advance'; room: string; version: number }
  | { op: 'seat'; room: string; seat: number; kind: 'human' | Level }
  /** give up your seat: a CPU plays it out and it ranks last */
  | { op: 'forfeit'; room: string };

/** Asks the server for the public key a browser needs to subscribe to push (null: push isn't set up). */
export interface PushKeyRequest { op: 'push-key' }
export interface PushKeyReply { key: string | null }

export interface PlayReply {
  room: RoomRow;
  /** your seat, or -1 when you're watching */
  seat: number;
  /** the game as you may see it: other hands, the deck and the RNG are hidden */
  view: GameState | null;
  /** seats whose corporation or research pick is in and waiting for their turn to come round */
  queued: number[];
}

/** Card id used in place of any card the viewer may not see. */
export const HIDDEN = '?';
