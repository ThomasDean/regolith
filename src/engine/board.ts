// The maps. Every board is a hex grid whose rows widen to a single middle row and narrow again
// (5..9..5 for the standard maps, 6..11..6 for Amazonis Planitia), with placement bonuses,
// ocean areas, optional volcanic areas and a few special spaces. Ids run "03".. in reading
// order, and the two off-Mars city spaces are the same on every map.
//
// Layouts follow the published maps: Tharsis (base game), Hellas and Elysium (Hellas & Elysium),
// Utopia Planitia and Terra Cimmeria (Utopia & Cimmeria), Amazonis Planitia and Vastitas
// Borealis (Amazonis & Vastitas). Effects that need expansions Regolith doesn't have yet
// (Turmoil delegates, Colonies) are left off.
import type { GameState, Space, SpaceBonus } from './types';

export type BoardId = 'tharsis' | 'hellas' | 'elysium' | 'utopia' | 'cimmeria' | 'vastitas' | 'amazonis';
export const BOARD_IDS: BoardId[] = ['tharsis', 'hellas', 'elysium', 'utopia', 'cimmeria', 'vastitas', 'amazonis'];

/** What crossing a value on a global-parameter track gives the player who raised it. */
export type TrackBonus = 'heatProd' | 'plantProd' | 'ocean' | 'temp' | 'card';

export interface BoardParams {
  maxTemp: number;
  maxOxy: number;
  maxOceans: number;
  temp: { at: number; bonus: TrackBonus }[];
  oxy: { at: number; bonus: TrackBonus }[];
}

export interface BoardDef {
  id: BoardId;
  name: string;
  /** the box the map comes in */
  from: string;
  /** one line on how the map plays */
  blurb: string;
  /** rules that differ from Tharsis, shown in setup */
  rules: string[];
  params: BoardParams;
  /** the map's own milestones and awards (some need expansions and are filled in at setup) */
  milestones: string[];
  awards: string[];
}

// Cell codes: L land, O ocean area, V volcanic land. Bonuses: s steel, t titanium, p plant,
// c card, h heat, e energy, w any one standard resource, O "pay 6 M€: place an ocean" (Hellas
// south pole), T "pay 4 M€: raise temperature" (Vastitas north pole).
type Cell = string;
const BONUS: Record<string, SpaceBonus> = { s: 'steel', t: 'titanium', p: 'plants', c: 'card', h: 'heat', e: 'energy', w: 'wild', O: 'ocean', T: 'temp', d: 'delegate' };
const COST: Partial<Record<SpaceBonus, number>> = { ocean: 6, temp: 4 };

const STANDARD: BoardParams = {
  maxTemp: 8, maxOxy: 14, maxOceans: 9,
  temp: [{ at: -24, bonus: 'heatProd' }, { at: -20, bonus: 'heatProd' }, { at: 0, bonus: 'ocean' }],
  oxy: [{ at: 8, bonus: 'temp' }],
};

interface Layout { rows: Cell[][]; names?: Record<string, string>; reserved?: string }

const LAYOUTS: Record<BoardId, Layout> = {
  tharsis: {
    rows: [
      ['L ss', 'O ss', 'L', 'O c', 'O'],
      ['L', 'V s', 'L', 'L', 'L', 'O cc'],
      ['V c', 'L', 'L', 'L', 'L', 'L', 'L s'],
      ['V pt', 'L p', 'L p', 'L p', 'L pp', 'L p', 'L p', 'O pp'],
      ['V pp', 'L pp', 'L pp', 'O pp', 'O pp', 'O pp', 'L pp', 'L pp', 'L pp'],
      ['L p', 'L pp', 'L p', 'L p', 'L p', 'O p', 'O p', 'O p'],
      ['L', 'L', 'L', 'L', 'L', 'L p', 'L'],
      ['L ss', 'L', 'L c', 'L c', 'L', 'L t'],
      ['L s', 'L ss', 'L', 'L', 'O tt'],
    ],
    names: { '09': 'Tharsis Tholus', '14': 'Ascraeus Mons', '21': 'Pavonis Mons', '29': 'Arsia Mons', '31': 'Noctis City' },
    reserved: '31',
  },
  hellas: {
    rows: [
      ['O pp', 'L pp', 'L pp', 'L ps', 'L p'],
      ['O pp', 'L pp', 'L p', 'L ps', 'L p', 'L p'],
      ['O p', 'L p', 'L s', 'L s', 'L', 'L pp', 'L pc'],
      ['O p', 'L p', 'L s', 'L ss', 'L s', 'O p', 'O p', 'L p'],
      ['L c', 'L', 'L', 'L ss', 'L', 'O c', 'O hhh', 'O', 'L p'],
      ['L t', 'L', 'L s', 'L', 'L', 'O', 'O s', 'L'],
      ['O tt', 'L', 'L', 'L c', 'L', 'L', 'L t'],
      ['L s', 'L c', 'L hh', 'L hh', 'L t', 'L t'],
      ['L', 'L hh', 'L O', 'L hh', 'L'],
    ],
    names: { '61': 'South Pole' },
  },
  elysium: {
    rows: [
      ['O', 'O t', 'O c', 'O s', 'L c'],
      ['V t', 'L', 'L', 'O', 'O', 'L ss'],
      ['V tt', 'L', 'L c', 'L', 'O p', 'O', 'V ccc'],
      ['L p', 'L p', 'L p', 'O pp', 'L p', 'O p', 'O p', 'L ps'],
      ['L pp', 'L pp', 'L pp', 'O pp', 'L pp', 'L ppp', 'L pp', 'L pp', 'V pt'],
      ['L s', 'L p', 'L p', 'L p', 'L p', 'L p', 'L p', 'L'],
      ['L t', 'L s', 'L', 'L', 'L s', 'L', 'L'],
      ['L ss', 'L', 'L', 'L', 'L ss', 'L'],
      ['L s', 'L', 'L c', 'L c', 'L ss'],
    ],
    names: { '08': 'Hecates Tholus', '14': 'Elysium Mons', '20': 'Olympus Mons', '37': 'Arsia Mons' },
  },
  utopia: {
    rows: [
      ['L', 'L', 'L ee', 'L', 'L'],
      ['L', 'L ss', 'L ee', 'L eec', 'L', 'L'],
      ['O ppp', 'L', 'L s', 'L', 'L', 'L cct', 'L tt'],
      ['O pc', 'L p', 'L p', 'L pp', 'O pp', 'O p', 'O p', 'L p'],
      ['L', 'L', 'L', 'L p', 'L p', 'L pp', 'L', 'O', 'L pt'],
      ['L s', 'L ss', 'O pp', 'L pp', 'L', 'L', 'L ss', 'L'],
      ['L s', 'L', 'O', 'O pp', 'L', 'L', 'L'],
      ['L', 'L cc', 'O', 'O pp', 'L st', 'L pp'],
      ['L', 'L', 'L ss', 'O p', 'L p'],
    ],
  },
  cimmeria: {
    rows: [
      ['O', 'L p', 'V s', 'L p', 'O pp'],
      ['O tt', 'L', 'L', 'L', 'L ps', 'O p'],
      ['L', 'L', 'L', 'L', 'L', 'L p', 'L'],
      ['V s', 'L', 'L s', 'L', 'L ss', 'L', 'V tt', 'L c'],
      ['L', 'L', 'L', 'L s', 'L s', 'L c', 'L', 'L sc', 'O'],
      ['V cc', 'L', 'L tss', 'L', 'L t', 'L ss', 'L', 'L ss'],
      ['L pp', 'L t', 'L', 'L pss', 'L pp', 'L p', 'O pp'],
      ['O', 'L p', 'L t', 'L c', 'L pp', 'O pp'],
      ['O pp', 'O p', 'O p', 'L p', 'O p'],
    ],
    names: { '05': 'Albor Tholus', '21': 'Tyrrhenus Mons', '27': 'Apollinaris Mons', '38': 'Hadriacus Mons' },
  },
  vastitas: {
    rows: [
      ['L p', 'L', 'V s', 'L', 'L'],
      ['L pp', 'L pp', 'L', 'L', 'L p', 'V c'],
      ['L c', 'O pp', 'O pp', 'L pp', 'L p', 'L', 'L'],
      ['V ss', 'L t', 'O pp', 'L p', 'L', 'L c', 'L p', 'L'],
      ['L', 'L', 'O p', 'L pp', 'L T', 'O pp', 'O pp', 'O pp', 'L cc'],
      ['L cc', 'L', 'L p', 'O hh', 'O hhp', 'O c', 'L p', 'L tt'],
      ['V t', 'L s', 'O', 'O hh', 'L pp', 'L p', 'L'],
      ['L p', 'L', 'L p', 'L ps', 'L s', 'L p'],
      ['L', 'L', 'L c', 'L s', 'L t'],
    ],
    names: { '33': 'North Pole' },
  },
  amazonis: {
    rows: [
      ['L s', 'L ss', 'L s', 'L c', 'L tt', 'L'],
      ['O', 'L d', 'L s', 'L', 'L p', 'O pp', 'O tt'],
      ['O ss', 'L', 'L cc', 'L', 'L p', 'O', 'L', 'L'],
      ['L t', 'O', 'L', 'L', 'L p', 'L p', 'L pp', 'L p', 'L pc'],
      ['V ss', 'L p', 'L w', 'L p', 'O c', 'L p', 'L pp', 'L p', 'L w', 'O pp'],
      ['L p', 'L p', 'L pp', 'L pp', 'O pp', 'O pp', 'L spp', 'L p', 'L', 'L p', 'O c'],
      ['L p', 'L pp', 'O pp', 'L ee', 'L e', 'L ee', 'L', 'L p', 'L p', 'L'],
      ['L p', 'O cc', 'L p', 'L e', 'L ee', 'L p', 'V dd', 'L s', 'V d'],
      ['O st', 'L', 'L t', 'L', 'L', 'L pp', 'L', 'V t'],
      ['O', 'L', 'L w', 'L', 'L ppp', 'L pp', 'V ss'],
      ['L', 'L st', 'L ss', 'L', 'L p', 'L c'],
    ],
    names: { '33': 'Hecates Tholus', '70': 'Olympus Mons', '72': 'Ascraeus Mons', '80': 'Pavonis Mons', '87': 'Arsia Mons' },
  },
};

export const BOARDS: Record<BoardId, BoardDef> = {
  tharsis: {
    id: 'tharsis', name: 'Tharsis', from: 'Base game', params: STANDARD,
    blurb: 'The classic map: the great volcanoes in the west, wide plant belt across the equator.',
    rules: ['Noctis City has its own reserved space.', 'Lava Flows goes on one of the four volcanoes.'],
    milestones: ['terraformer', 'mayor', 'gardener', 'builder', 'planner'],
    awards: ['landlord', 'banker', 'scientist', 'thermalist', 'miner'],
  },
  hellas: {
    id: 'hellas', name: 'Hellas', from: 'Hellas & Elysium', params: STANDARD,
    blurb: 'The southern highlands around the Hellas basin: metal in the middle, heat at the pole.',
    rules: [
      'South Pole: placing a tile there costs 6 M€ and lets you place an ocean (free once the oceans are all out).',
      'No volcanoes: Lava Flows may go on any land space.',
      'No Noctis region: Noctis City is placed like any other city.',
    ],
    milestones: ['diversifier', 'tactician', 'polar-explorer', 'energizer', 'rim-settler'],
    awards: ['cultivator', 'magnate', 'space-baron', 'excentric', 'contractor'],
  },
  elysium: {
    id: 'elysium', name: 'Elysium', from: 'Hellas & Elysium', params: STANDARD,
    blurb: 'The northern lowlands: oceans in the north, steel-rich plains in the south.',
    rules: [
      'Lava Flows goes on one of the four volcanoes (Hecates Tholus, Elysium Mons, Olympus Mons, Arsia Mons).',
      'No Noctis region: Noctis City is placed like any other city.',
    ],
    milestones: ['generalist', 'specialist', 'ecologist', 'tycoon', 'legend'],
    awards: ['celebrity', 'industrialist', 'desert-settler', 'estate-dealer', 'benefactor'],
  },
  utopia: {
    id: 'utopia', name: 'Utopia Planitia', from: 'Utopia & Cimmeria', params: STANDARD,
    blurb: 'A vast northern plain with energy deposits and two rich landing sites.',
    rules: [
      'The two landing sites (two-card spaces) pay extra cards.',
      'No volcanoes: Lava Flows may go on any land space.',
      'No Noctis region: Noctis City is placed like any other city.',
      'Pioneer (colonies) needs Colonies; without it another milestone takes its place.',
    ],
    milestones: ['manager', 'trader', 'metallurgist', 'researcher', 'pioneer'],
    awards: ['suburbian', 'investor', 'botanist', 'incorporator', 'metropolist'],
  },
  cimmeria: {
    id: 'cimmeria', name: 'Terra Cimmeria', from: 'Utopia & Cimmeria', params: STANDARD,
    blurb: 'Cratered southern uplands: oceans pool along the south edge, metals everywhere else.',
    rules: [
      'Lava Flows goes on one of the four volcanic areas.',
      'No Noctis region: Noctis City is placed like any other city.',
      'The Gale crater colony space only matters with Colonies, so it is a plain land space here.',
      'Planetologist needs Venus Next; without it another milestone takes its place.',
    ],
    milestones: ['architect', 'coastguard', 'forester', 'fundraiser', 'planetologist'],
    awards: ['electrician', 'founder', 'mogul', 'zoologist', 'forecaster'],
  },
  vastitas: {
    id: 'vastitas', name: 'Vastitas Borealis', from: 'Amazonis & Vastitas', params: STANDARD,
    blurb: 'Centred on the North Pole: ice-filled lowlands ringed by heat-rich frozen ground.',
    rules: [
      'North Pole: placing a tile on the frozen CO₂ costs 4 M€ and raises the temperature 1 step (free once temperature is maxed).',
      'Lava Flows goes on one of the four volcanic areas.',
      'No Noctis region: Noctis City is placed like any other city.',
      'Viking delegate bonuses aren’t on this version of the map.',
    ],
    milestones: ['agronomist', 'engineer', 'spacefarer', 'geologist', 'farmer'],
    awards: ['traveller', 'landscaper', 'highlander', 'promoter', 'blacksmith'],
  },
  amazonis: {
    id: 'amazonis', name: 'Amazonis Planitia', from: 'Amazonis & Vastitas',
    params: {
      maxTemp: 14, maxOxy: 18, maxOceans: 11,
      temp: [{ at: -24, bonus: 'heatProd' }, { at: -20, bonus: 'heatProd' }, { at: -12, bonus: 'plantProd' }, { at: 0, bonus: 'ocean' }],
      oxy: [{ at: 7, bonus: 'card' }, { at: 11, bonus: 'temp' }],
    },
    blurb: 'A bigger 91-space map with longer tracks, made for 4–5 players and longer games.',
    rules: [
      'Longer tracks: temperature to +14 °C, oxygen to 18 %, 11 oceans.',
      'Track bonuses: +1 plant production at −12 °C, a card at 7 % oxygen, a temperature step at 11 % oxygen.',
      'Wild bonus spaces give any one standard resource of your choice.',
      'Lava Flows goes on one of the five volcanoes. Noctis City is placed like any other city.',
      'Delegate bonuses place one of your delegates with Turmoil (nothing otherwise). Lobbyist needs Turmoil; without it another milestone takes its place.',
    ],
    milestones: ['terran', 'landshaper', 'merchant', 'sponsor', 'lobbyist'],
    awards: ['collector', 'innovator', 'constructor', 'manufacturer', 'physicist'],
  },
};

export const NOCTIS = '31';
export const GANYMEDE = 'g1';
export const PHOBOS = 'g2';
/** Venus Next's city spaces off Mars. */
export const OFF_SPACES = { dawnCity: 'v1', lunaMetropolis: 'v2', maxwellBase: 'v3', stratopolis: 'v4' } as const;
const OFF_NAMES: Record<string, string> = { v1: 'Dawn City', v2: 'Luna Metropolis', v3: 'Maxwell Base', v4: 'Stratopolis' };
export const MAX_VENUS = 30;
/** Kept for older imports: Tharsis' volcanoes. */
export const VOLCANIC = ['09', '14', '21', '29'];

export function createBoard(id: BoardId = 'tharsis', opts: { venus?: boolean } = {}): Space[] {
  const { rows, names = {}, reserved } = LAYOUTS[id];
  const mid = (rows.length - 1) / 2;
  const spaces: Space[] = [];
  let n = 3;
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const [kind, codes = ''] = cell.split(' ');
      const sid = String(n++).padStart(2, '0');
      const bonus = [...codes].map((ch) => BONUS[ch]);
      const sp: Space = { id: sid, row: r, col: c, x: Math.abs(r - mid) + c * 2, type: kind === 'O' ? 'ocean' : 'land', bonus };
      if (names[sid]) sp.name = names[sid];
      if (kind === 'V') sp.volcanic = true;
      if (r === 0 || r === rows.length - 1 || c === 0 || c === row.length - 1) sp.edge = true;
      if (sid === reserved) sp.reserved = true;
      const cost = bonus.reduce((a, b) => a + (COST[b] ?? 0), 0);
      if (cost) sp.cost = cost;
      spaces.push(sp);
    });
  });
  spaces.push({ id: GANYMEDE, row: -1, col: 0, x: 0, type: 'off', bonus: [], name: 'Ganymede Colony' });
  spaces.push({ id: PHOBOS, row: -1, col: 1, x: 0, type: 'off', bonus: [], name: 'Phobos Space Haven' });
  if (opts.venus) Object.values(OFF_SPACES).forEach((sid, i) => spaces.push({ id: sid, row: -1, col: 2 + i, x: 0, type: 'off', bonus: [], name: OFF_NAMES[sid] }));
  return spaces;
}

/** Rows on a board (9 for the standard maps, 11 for Amazonis Planitia). */
export const boardRows = (id: BoardId) => LAYOUTS[id].rows.length;

export const boardId = (s: Pick<GameState, 'options'>): BoardId => s.options.board ?? 'tharsis';
export const boardDef = (s: Pick<GameState, 'options'>): BoardDef => BOARDS[boardId(s)];
export const params = (s: Pick<GameState, 'options'>): BoardParams => BOARDS[boardId(s)].params;
export const maxTemp = (s: Pick<GameState, 'options'>) => params(s).maxTemp;
export const maxOxy = (s: Pick<GameState, 'options'>) => params(s).maxOxy;
export const maxOceans = (s: Pick<GameState, 'options'>) => params(s).maxOceans;
/** Global-parameter steps on this board's tracks. */
export const totalSteps = (s: Pick<GameState, 'options'>) => (maxTemp(s) + 30) / 2 + maxOxy(s) + maxOceans(s);

// Neighbours are cached per map shape (all standard maps share one; Amazonis has its own).
const ADJ = new Map<string, string[]>();

export function neighbours(board: Space[], id: string): Space[] {
  const key = `${board.length}:${id}`;
  let ids = ADJ.get(key);
  if (!ids) {
    const a = board.find((s) => s.id === id)!;
    ids = a.type === 'off'
      ? []
      : board
        .filter((b) => b.type !== 'off' && b.id !== id && ((b.row === a.row && Math.abs(b.x - a.x) === 2) || (Math.abs(b.row - a.row) === 1 && Math.abs(b.x - a.x) === 1)))
        .map((b) => b.id);
    ADJ.set(key, ids);
  }
  return ids.map((n) => board.find((s) => s.id === n)!);
}

export const onMars = (s: Space) => s.type !== 'off';
