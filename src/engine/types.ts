// Core types for the Regolith engine. Game state is plain JSON: it can be saved, cloned,
// replayed from its seed, or moved to a server unchanged.

export type Res = 'mc' | 'steel' | 'titanium' | 'plants' | 'energy' | 'heat';
export const RESOURCES: Res[] = ['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'];

export type Tag =
  | 'building' | 'space' | 'science' | 'power' | 'earth' | 'jovian'
  | 'plant' | 'microbe' | 'animal' | 'city' | 'event';
export const TAGS: Tag[] = ['building', 'space', 'science', 'power', 'earth', 'jovian', 'plant', 'microbe', 'animal', 'city', 'event'];

export type CardRes = 'microbe' | 'animal' | 'science' | 'fighter';
export type CardType = 'automated' | 'active' | 'event' | 'corp';
export type Level = 'easy' | 'normal' | 'hard';
export type StdProject = 'sell' | 'power' | 'asteroid' | 'aquifer' | 'greenery' | 'city';

export const MAX_TEMP = 8;
export const MIN_TEMP = -30;
export const MAX_OXY = 14;
export const MAX_OCEANS = 9;

export type TileKind = 'ocean' | 'greenery' | 'city' | 'special';

/** Placement rule for a tile. */
export type Placement =
  | 'ocean' | 'oceanArea' | 'land' | 'city' | 'cityIsolated' | 'isolated' | 'adj2Cities' | 'adjCity'
  | 'adjGreenery' | 'volcanic' | 'noctis' | 'ganymede' | 'phobos' | 'miningRights' | 'miningArea'
  | 'claim' | 'greenery';

export type SpaceBonus = 'steel' | 'titanium' | 'plants' | 'card';

export interface Space {
  id: string;
  row: number;
  col: number;
  /** horizontal position in half-hex units */
  x: number;
  type: 'land' | 'ocean' | 'off';
  bonus: SpaceBonus[];
  name?: string;
  tile?: { kind: TileKind; owner: number | null; card?: string };
  claimedBy?: number;
}

export interface ChooseOption { label: string; ops: Op[]; ok: boolean }

/** Small effect ops. Card effects compile to a queue of these. */
export type Op =
  | { k: 'res'; r: Res; n: number }
  | { k: 'prod'; r: Res; n: number }
  | { k: 'tr'; n: number }
  | { k: 'log'; text: string }
  | { k: 'temp'; n: number }
  | { k: 'oxy'; n: number }
  | { k: 'ocean' }
  | { k: 'tile'; tile: TileKind; rule: Placement; card?: string }
  | { k: 'removeAny'; r: Res; n: number; among?: number[] }
  | { k: 'steal'; r: Res; n: number }
  | { k: 'decProd'; r: Res; n: number; gain?: boolean }
  | { k: 'addRes'; n: number; target: 'this' | 'other' | 'anyWithRes'; rtype?: CardRes; card?: string }
  | { k: 'removeCardRes'; n: number; rtype: CardRes; gainTo?: string }
  | { k: 'draw'; n: number }
  | { k: 'look'; n: number; keep: number; buy: boolean }
  | { k: 'choose'; title: string; options: ChooseOption[] }
  | { k: 'discardDraw' }
  | { k: 'amount'; id: 'insulation' | 'powerInfra'; title: string; max: number }
  | { k: 'robotic' }
  | { k: 'searchLife'; card: string };

export interface QueueItem { pid: number; op: Op; src?: string }

export type Prompt =
  | { kind: 'space'; pid: number; title: string; options: string[]; item: QueueItem }
  | { kind: 'player'; pid: number; title: string; options: number[]; optional: boolean; item: QueueItem }
  | { kind: 'card'; pid: number; title: string; options: string[]; optional: boolean; item: QueueItem }
  | { kind: 'choice'; pid: number; title: string; options: { label: string; ok: boolean }[]; item: QueueItem }
  | { kind: 'cards'; pid: number; title: string; cards: string[]; min: number; max: number; costEach: number; item: QueueItem }
  | { kind: 'amount'; pid: number; title: string; max: number; item: QueueItem };

export interface Payment { steel?: number; titanium?: number; heat?: number }
export interface PayLimits { steel: boolean; titanium: boolean; heat: boolean }

export type Action =
  | { t: 'setup'; corp: string; keep: string[] }
  | { t: 'research'; keep: string[] }
  | { t: 'play'; card: string; pay?: Payment }
  | { t: 'sp'; id: StdProject; pay?: Payment; cards?: string[] }
  | { t: 'cardAction'; card: string; pay?: Payment }
  | { t: 'milestone'; id: string; pay?: Payment }
  | { t: 'award'; id: string; pay?: Payment }
  | { t: 'plants' }
  | { t: 'heat' }
  | { t: 'endTurn' }
  | { t: 'pass' }
  | { t: 'answer'; space?: string; player?: number | null; card?: string | null; option?: number; cards?: string[]; amount?: number };

export interface Player {
  id: number;
  name: string;
  color: string;
  cpu: Level | null;
  corp: string | null;
  tr: number;
  res: Record<Res, number>;
  prod: Record<Res, number>;
  hand: string[];
  /** cards in play, events included, in the order played */
  played: string[];
  cardRes: Record<string, number>;
  usedActions: string[];
  passed: boolean;
  trRaisedThisGen: boolean;
  firstActionDone: boolean;
  nextCardDiscount: number;
  reqBonusNext: number;
  stats: { greeneries: number; citiesPlaced: number };
  setup?: { corps: string[]; cards: string[] };
  research?: string[];
}

export interface PlayerSeat { name: string; color: string; cpu: Level | null }

export type Phase = 'setup' | 'research' | 'action' | 'finalGreenery' | 'over';

export interface LogEntry { gen: number; pid: number | null; text: string }

export interface GameState {
  options: { corporateEra: boolean; seed: number };
  rng: number;
  phase: Phase;
  generation: number;
  firstPlayer: number;
  /** whoever must act now (outside prompts) */
  active: number;
  actionsThisTurn: number;
  temperature: number;
  oxygen: number;
  oceans: number;
  board: Space[];
  players: Player[];
  deck: string[];
  discard: string[];
  milestones: { id: string; pid: number }[];
  awards: { id: string; pid: number }[];
  queue: QueueItem[];
  prompt: Prompt | null;
  /** the action whose effects are resolving; counts=false for final greenery */
  pendingAction: { pid: number; counts: boolean } | null;
  log: LogEntry[];
  finalOrder: number[];
  /** increments whenever hidden information is revealed (cards drawn); used to gate undo */
  reveal: number;
}
