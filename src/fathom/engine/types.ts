// Fathom: state, cards and actions. Pure data, no DOM.

export type Level = 'easy' | 'normal' | 'hard';
export type Zone = 'sun' | 'twi' | 'mid';
export type Tag = 'predator' | 'venomous' | 'camouflage' | 'glow' | 'electric';

/** The ocean is a grid of 3 dive sites (columns) by 6 rows: two rows per zone. */
export const COLS = 3;
export const ROWS = 6;
export const SLOTS = COLS * ROWS;
export const TIDES = 4;
export const DIVERS = 6;
export const SCHOOL_PTS = 6;

export const slotOf = (row: number, col: number) => row * COLS + col;
export const rowOf = (slot: number) => Math.floor(slot / COLS);
export const colOf = (slot: number) => slot % COLS;
export const zoneOfRow = (row: number): Zone => (row < 2 ? 'sun' : row < 4 ? 'twi' : 'mid');
export const zoneOf = (slot: number) => zoneOfRow(rowOf(slot));
/** the top row is the shallows (estuary), the bottom row the abyss */
export const SHALLOWS = 0;
export const ABYSS = ROWS - 1;

/** Which fish an effect may target. */
export interface Filter { zone?: Zone; tag?: Tag; sameCol?: boolean }

export type Effect =
  | { k: 'draw'; n: number }
  /** put an egg on up to n different fish that have none */
  | { k: 'egg'; n: number; where?: Filter }
  /** an egg on every one of your fish (matching the filter) that has none */
  | { k: 'eggEach'; where: Filter }
  /** turn up to n eggs into fry */
  | { k: 'hatch'; n: number }
  /** add n fry from the supply to any slots */
  | { k: 'fry'; n: number }
  /** move one fry or one school any distance in a straight line */
  | { k: 'move' }
  /** take a card back from your discard pile (draw one if it's empty) */
  | { k: 'recover' }
  /** discard a card from hand to draw one */
  | { k: 'cycle' }
  /** every player gets this (each may decline; it's never a cost) */
  | { k: 'all'; e: Extract<Effect, { k: 'draw' } | { k: 'eggEach' }> };

/** End-of-game points a fish scores beyond its printed value. */
export type EndRule =
  | { k: 'tag'; tag: Tag; pts: number }
  | { k: 'zone'; zone: Zone; pts: number }
  | { k: 'eggsCol'; pts: number }
  | { k: 'fishCol'; pts: number }
  | { k: 'schools'; pts: number }
  | { k: 'hand'; pts: number; max: number }
  | { k: 'beneath'; pts: number };

export interface Cost { cards?: number; eggs?: number; fry?: number; eat?: boolean }

export interface FishDef {
  id: string;
  name: string;
  /** body length class, 2 (small) to 6 (huge); bait fish are 1 */
  len: number;
  pts: number;
  zones: Zone[];
  /** must go in this dive site */
  site?: number;
  /** only in the shallows (top row) or the abyss (bottom row) */
  edge?: 'shallows' | 'abyss';
  tags: Tag[];
  cost: Cost;
  play?: Effect[];
  dive?: Effect[];
  end?: EndRule;
  starter?: boolean;
}

export interface Slot {
  /** fish stacked here, bottom first; the last one is the one you see. `bait` is a printed bait fish. */
  fish: string[];
  egg: boolean;
  fry: number;
  school: boolean;
}

export interface FPlayer {
  id: number;
  name: string;
  color: string;
  cpu: Level | null;
  forfeited?: boolean;
  hand: string[];
  discard: string[];
  ocean: Slot[];
  /** divers still to place this tide */
  divers: number;
  /** each dive site's bottom bonus taken this tide */
  bottom: boolean[];
  /** goal points per tide (tides 1–3) */
  goals: number[];
  /** what this player did on each turn, for the end screen */
  stats: { released: number; dives: number; eaten: number };
}

export type GoalId = 'brood' | 'rows' | 'schools' | 'hunters' | 'deep' | 'sunlit' | 'giants' | 'feast' | 'columns';

export interface FOptions {
  seed: number;
  /** false: the classic goals (brood, rows, schools); true: three drawn at random, +3 to each tide's leader */
  variable: boolean;
}

export interface QueueItem { pid: number; e: Effect; src: string; slot?: number }

export interface PromptOption {
  label: string;
  slot?: number;
  card?: string;
  move?: { from: number; to: number; what: 'fry' | 'school' };
}

export interface FPrompt {
  pid: number;
  kind: 'egg' | 'hatch' | 'fry' | 'move' | 'recover' | 'cycle';
  title: string;
  src: string;
  options: PromptOption[];
  /** how many more of this after the current one (an "up to 2 eggs" asks twice) */
  left: number;
  /** the effect being resolved (re-queued while `left` > 0) */
  item: QueueItem;
  srcSlot?: number;
}

export interface LogEntry { tide: number; pid: number | null; text: string }

/** What a single dive did, step by step, for the dive animation. */
export interface DiveTrace { pid: number; col: number; turn: number }

export interface FState {
  game: 'fathom';
  v: 1;
  options: FOptions;
  rng: number;
  phase: 'play' | 'over';
  tide: number;
  turn: number;
  first: number;
  active: number;
  players: FPlayer[];
  deck: string[];
  goals: GoalId[];
  queue: QueueItem[];
  prompt: FPrompt | null;
  /** the player whose action is still resolving */
  acting: number | null;
  log: LogEntry[];
  lastDive: DiveTrace | null;
  endedBy?: 'forfeit';
  /** per tide, each player's score after it (for the end chart) */
  history: number[][];
}

export type FAction =
  | { t: 'release'; card: string; slot: number; pay: { cards: string[]; eggs: number[]; fry: number[] } }
  | { t: 'dive'; col: number }
  /** index into the prompt's options, or null to skip */
  | { t: 'answer'; choice: number | null };

export interface SeatSpec { name: string; color: string; cpu: Level | null }
