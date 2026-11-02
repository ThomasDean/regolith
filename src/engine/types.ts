// Core types for the Regolith engine. Game state is plain JSON: it can be saved, cloned,
// replayed from its seed, or moved to a server unchanged.

export type Res = 'mc' | 'steel' | 'titanium' | 'plants' | 'energy' | 'heat';
export const RESOURCES: Res[] = ['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'];

export type Tag =
  | 'building' | 'space' | 'science' | 'power' | 'earth' | 'jovian'
  | 'plant' | 'microbe' | 'animal' | 'city' | 'event' | 'venus' | 'wild';
/** Every tag. 'wild' (Prelude, Turmoil) counts as any one tag for requirements only. */
export const TAGS: Tag[] = ['building', 'space', 'science', 'power', 'earth', 'jovian', 'venus', 'plant', 'microbe', 'animal', 'city', 'event', 'wild'];

export type CardRes = 'microbe' | 'animal' | 'science' | 'fighter' | 'floater' | 'asteroid' | 'camp' | 'preservation';
export type CardType = 'automated' | 'active' | 'event' | 'corp' | 'prelude';
export type Level = 'easy' | 'normal' | 'hard';
export type StdProject = 'sell' | 'power' | 'asteroid' | 'aquifer' | 'greenery' | 'city' | 'venus' | 'colony';

/** The expansions a game is played with (all off in older saves). */
export type Expansion = 'prelude' | 'venus' | 'colonies' | 'turmoil';
export const EXPANSIONS: Expansion[] = ['prelude', 'venus', 'colonies', 'turmoil'];
export type Expansions = Partial<Record<Expansion, boolean>>;

export type PartyId = 'mars' | 'scientists' | 'unity' | 'greens' | 'reds' | 'kelvinists';
export const PARTIES: PartyId[] = ['mars', 'scientists', 'unity', 'greens', 'reds', 'kelvinists'];
/** A delegate: a player id, or NEUTRAL. */
export const NEUTRAL = -1;

export const MAX_TEMP = 8;
export const MIN_TEMP = -30;
export const MAX_OXY = 14;
export const MAX_OCEANS = 9;

export type TileKind = 'ocean' | 'greenery' | 'city' | 'special';

/** Placement rule for a tile. */
export type Placement =
  | 'ocean' | 'oceanArea' | 'land' | 'city' | 'cityIsolated' | 'isolated' | 'adj2Cities' | 'adjCity'
  | 'adjGreenery' | 'volcanic' | 'noctis' | 'ganymede' | 'phobos' | 'miningRights' | 'miningArea'
  | 'claim' | 'greenery' | 'volcanicCity' | 'dawnCity' | 'lunaMetropolis' | 'maxwellBase' | 'stratopolis';

/** Placement bonuses. 'wild' = any one standard resource; 'ocean' and 'temp' come with an M€ cost. */
export type SpaceBonus = 'steel' | 'titanium' | 'plants' | 'card' | 'heat' | 'energy' | 'wild' | 'ocean' | 'temp' | 'delegate';

export interface Space {
  id: string;
  row: number;
  col: number;
  /** horizontal position in half-hex units */
  x: number;
  type: 'land' | 'ocean' | 'off';
  bonus: SpaceBonus[];
  name?: string;
  /** volcanic area (Lava Flows) */
  volcanic?: boolean;
  /** on the map's border (Suburbian) */
  edge?: boolean;
  /** reserved for a card (Noctis City on Tharsis) */
  reserved?: boolean;
  /** M€ to pay when placing a tile here (Hellas south pole, Vastitas north pole) */
  cost?: number;
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
  /** `wgt`: raised by World Government Terraforming (no TR, no bonuses) */
  | { k: 'temp'; n: number; wgt?: boolean }
  | { k: 'oxy'; n: number; wgt?: boolean }
  | { k: 'ocean'; wgt?: boolean }
  | { k: 'venus'; n: number; wgt?: boolean }
  | { k: 'lowerTemp'; n: number }
  | { k: 'tile'; tile: TileKind; rule: Placement; card?: string; wgt?: boolean }
  | { k: 'removeAny'; r: Res; n: number; among?: number[] }
  | { k: 'steal'; r: Res; n: number }
  | { k: 'decProd'; r: Res; n: number; gain?: boolean }
  /** 'any' includes the source card; `tag` limits targets to cards with that tag (a Venus card…) */
  | { k: 'addRes'; n: number; target: 'this' | 'other' | 'anyWithRes' | 'any'; rtype?: CardRes; card?: string; tag?: Tag }
  | { k: 'removeCardRes'; n: number; rtype: CardRes; gainTo?: string }
  /** spend resources from one of your own cards (Stratospheric Birds, Air Raid, Corrosive Rain) */
  | { k: 'spendRes'; n: number; rtype: CardRes }
  | { k: 'draw'; n: number }
  | { k: 'look'; n: number; keep: number; buy: boolean }
  | { k: 'choose'; title: string; options: ChooseOption[] }
  | { k: 'discardDraw' }
  | { k: 'amount'; id: 'insulation' | 'powerInfra' | 'sulphur' | 'titanShuttles'; title: string; max: number }
  /** pay M€ as part of an effect (titanium/steel allowed if marked) */
  | { k: 'pay'; n: number; steel?: boolean; titanium?: boolean }
  | { k: 'othersDraw'; n: number }
  | { k: 'robotic' }
  | { k: 'searchLife'; card: string }
  /** reveal cards until `n` match (a tag or a resource icon); keep those, discard the rest */
  | { k: 'drawMatching'; n: number; tag?: Tag; rtype?: CardRes }
  | { k: 'discard'; n: number }
  /** play a card from hand now (Ecology Experts: ignoring global requirements; Eccentric Sponsor: 25 M€ less) */
  | { k: 'playFromHand'; discount: number; ignoreReq: boolean; src: string }
  | { k: 'preludeDraw'; n: number }
  | { k: 'freeAward' }
  | { k: 'viron' }
  | { k: 'lowestProd' }
  | { k: 'wgt' }
  // Colonies
  | { k: 'colony'; dup?: boolean }
  | { k: 'fleet'; n: number }
  | { k: 'trade'; free: boolean }
  | { k: 'addColonyTile' }
  | { k: 'marketManip' }
  | { k: 'colonyBonuses' }
  // Turmoil
  | { k: 'delegate'; n: number; one?: boolean; from?: 'reserve' | 'lobby' }
  | { k: 'removeDelegate' }
  | { k: 'recruit' }
  | { k: 'noConfidence' }
  | { k: 'removeOcean' };

export interface QueueItem { pid: number; op: Op; src?: string }

export type Prompt =
  | { kind: 'space'; pid: number; title: string; options: string[]; item: QueueItem }
  | { kind: 'player'; pid: number; title: string; options: number[]; optional: boolean; item: QueueItem }
  | { kind: 'card'; pid: number; title: string; options: string[]; optional: boolean; item: QueueItem }
  /** `keys` identify the options of choices built from the state (colony tiles, parties…) */
  | { kind: 'choice'; pid: number; title: string; options: { label: string; ok: boolean }[]; item: QueueItem; keys?: string[] }
  | { kind: 'cards'; pid: number; title: string; cards: string[]; min: number; max: number; costEach: number; item: QueueItem }
  | { kind: 'amount'; pid: number; title: string; max: number; item: QueueItem };

/** M€ alternatives: metals, Helion's heat, Dirigibles' floaters (3 M€, Venus cards), Psychrophiles' microbes (2 M€, plant cards) */
export interface Payment { steel?: number; titanium?: number; heat?: number; floaters?: number; microbes?: number }
export interface PayLimits { steel: boolean; titanium: boolean; heat: boolean; floaters?: boolean; microbes?: boolean }

export type Action =
  | { t: 'setup'; corp: string; keep: string[]; preludes?: string[] }
  | { t: 'prelude'; card: string }
  | { t: 'trade'; colony: string; pay: 'mc' | 'energy' | 'titanium' }
  | { t: 'delegate'; party: PartyId }
  | { t: 'policy' }
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
  setup?: { corps: string[]; cards: string[]; preludes?: string[] };
  research?: string[];
  /** Prelude: the two preludes still to play at the start of the game */
  preludes?: string[];
  /** Colonies: trade fleets owned and sent out this generation */
  fleets?: number;
  fleetsUsed?: number;
  /** Turmoil: used the ruling party's once-a-generation action */
  policyUsed?: boolean;
}

export interface PlayerSeat { name: string; color: string; cpu: Level | null }

export type Phase = 'setup' | 'prelude' | 'research' | 'action' | 'finalGreenery' | 'over';

export interface LogEntry { gen: number; pid: number | null; text: string }

/** One sample of the scoreboard, taken at the end of every turn (for the end-of-game charts). */
export interface HistoryPoint {
  gen: number;
  /** turn number in the game (1-based) */
  turn: number;
  /** whose turn just ended; null for the end-of-generation and final samples */
  pid: number | null;
  /** per player, current VP total (awards counted as they stand) */
  vp: number[];
  tr: number[];
  /** per player, M€ production + TR (income) */
  income: number[];
  temp: number;
  oxy: number;
  oceans: number;
  venus?: number;
}

export interface GameOptions {
  corporateEra: boolean;
  seed: number;
  /** map; absent = Tharsis (older saves) */
  board?: import('./board').BoardId;
  /** milestone and award ids in play; absent = Tharsis' (older saves) */
  milestones?: string[];
  awards?: string[];
  expansions?: Expansions;
}

export interface ColonyState {
  id: string;
  /** track marker position, 0–6 */
  track: number;
  /** tiles that need a card resource (Enceladus, Miranda, Titan) wait until such a card is played */
  active: boolean;
  /** owner of each colony on the tile, in build order (up to 3) */
  colonies: number[];
  /** the player whose fleet is docked here this generation, if any */
  fleet: number | null;
}

export interface PartyState { delegates: number[]; leader: number | null }

export interface GlobalEventState { id: string }

export interface TurmoilState {
  parties: Record<PartyId, PartyState>;
  ruling: PartyId;
  dominant: PartyId;
  chairman: number;
  /** delegates left in reserve, per player; neutral reserve separately */
  reserve: number[];
  neutral: number;
  /** players who placed their free (lobby) delegate this generation */
  lobbyUsed: number[];
  deck: string[];
  discard: string[];
  current: string | null;
  coming: string | null;
  distant: string | null;
}

/** What happens once the end-of-generation step now resolving is done. */
export type GenStep = 'prelude' | 'solar' | 'colonies' | 'turmoil' | 'turmoilEnd' | 'newGen';

export interface GameState {
  options: GameOptions;
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
  pendingAction: { pid: number; counts: boolean; then?: GenStep } | null;
  log: LogEntry[];
  finalOrder: number[];
  /** increments whenever hidden information is revealed (cards drawn); used to gate undo */
  reveal: number;
  /** scoreboard samples for the end-of-game charts (absent in older saves) */
  history?: HistoryPoint[];
  /** per player, how many times each global parameter was raised (absent in older saves) */
  raised?: { temp: number; oxy: number; ocean: number; venus?: number }[];
  turns?: number;
  // ---- expansions (absent when not in play) ----
  /** Venus scale, 0–30 % in steps of 2 */
  venus?: number;
  preludeDeck?: string[];
  colonies?: ColonyState[];
  /** colony tiles not in play (Aridor adds one) */
  spareColonies?: string[];
  turmoil?: TurmoilState;
}
