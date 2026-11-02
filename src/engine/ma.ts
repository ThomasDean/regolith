// Milestones and awards: the full catalogue from the published maps, the set in play for a game,
// and a balanced random draw that keeps look-alikes apart.
//
// Each milestone or award says what it rewards as a small profile over "axes" (tiles, greenery
// tiles, building tags, steel production…), weights summing to 1. Two of them conflict as much
// as their profiles overlap: Gardener and Cultivator both reward greeneries (overlap 1, conflict
// 9), Mayor and Landlord share tiles and cities (5), Builder and Scientist share nothing (0).
// Random draws keep every pair at or below a threshold and spread the ten across kinds of play.
import type { CardRes, Expansion, Expansions, GameState, Res, Space, Tag } from './types';
import { RESOURCES, TAGS } from './types';
import { CARDS } from './cards';
import { BOARDS, boardRows, neighbours, type BoardId } from './board';
import { cities, eventsPlayed, greeneries, marsTiles, P, resOnCards, tagCount } from './helpers';
import { colonyCount } from './colonies';
import { delegatesOut } from './turmoil';

export type Family = 'tiles' | 'tags' | 'cards' | 'production' | 'resources' | 'tr';

interface Base {
  id: string;
  name: string;
  text: string;
  family: Family;
  /** what it rewards: axis -> weight (sums to 1) */
  axes: Record<string, number>;
  metric: (s: GameState, pid: number) => number;
  /** maps it comes from */
  boards: BoardId[];
  /** can't be used on this board (Geologist without volcanoes) */
  unavailable?: (b: BoardId) => string | null;
  /** needs this expansion */
  needs?: Expansion;
}
export interface Milestone extends Base { kind: 'milestone'; need: number }
export interface Award extends Base {
  kind: 'award';
  /**
   * Forecast model for CPUs: spread of the metric per sqrt(generation) and how fast leads widen
   * (scripts/award-drift.ts). `project` marks resource stocks that get spent and refilled.
   */
  drift: { sd: number; widen: number };
  project?: 'heat' | 'metal' | 'steelEnergy';
}
export type MADef = Milestone | Award;

// ---------------- metric helpers ----------------
const realTiles = (s: GameState, pid: number) => marsTiles(s, pid);
const isSpecial = (x: Space) => x.tile?.kind === 'special';
const adjOcean = (s: GameState, x: Space) => neighbours(s.board, x.id).some((n) => n.tile?.kind === 'ocean');
const rows = (s: GameState) => boardRows(s.options.board ?? 'tharsis');
const projects = (s: GameState, pid: number) => P(s, pid).played.filter((id) => CARDS[id].type === 'automated' || CARDS[id].type === 'active');
const resOn = (s: GameState, pid: number, types?: CardRes[]) => {
  const p = P(s, pid);
  let n = 0;
  for (const id of p.corp ? [p.corp, ...p.played] : p.played) {
    const r = CARDS[id].resource;
    if (r && (!types || types.includes(r))) n += p.cardRes[id] ?? 0;
  }
  return n;
};
const resTypes = (s: GameState, pid: number) => {
  const p = P(s, pid);
  return new Set((p.corp ? [p.corp, ...p.played] : p.played).filter((id) => CARDS[id].resource && (p.cardRes[id] ?? 0) > 0).map((id) => CARDS[id].resource)).size;
};
const withReq = (s: GameState, pid: number) => P(s, pid).played.filter((id) => CARDS[id].type !== 'event' && CARDS[id].req).length;
const distinctTags = (s: GameState, pid: number) => TAGS.filter((t) => t !== 'event' && t !== 'wild' && tagCount(s, pid, t) > 0).length + Math.min(1, tagCount(s, pid, 'wild'));
const tags = (s: GameState, pid: number, ts: Tag[]) => ts.reduce((a, t) => a + tagCount(s, pid, t), 0);
const prod = (s: GameState, pid: number, rs: Res[]) => rs.reduce((a, r) => a + P(s, pid).prod[r], 0);
function largestGroup(s: GameState, pid: number): number {
  const mine = new Set(realTiles(s, pid).map((x) => x.id));
  let best = 0;
  const seen = new Set<string>();
  for (const id of mine) {
    if (seen.has(id)) continue;
    let size = 0;
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      size++;
      for (const n of neighbours(s.board, cur)) if (mine.has(n.id) && !seen.has(n.id)) { seen.add(n.id); stack.push(n.id); }
    }
    best = Math.max(best, size);
  }
  return best;
}
const noVolcanoes = (b: BoardId) => (b === 'hellas' || b === 'utopia' ? 'This map has no volcanic areas' : null);

// ---------------- the catalogue ----------------
const M = (id: string, name: string, text: string, need: number, family: Family, axes: Record<string, number>, boards: BoardId[], metric: Milestone['metric'], extra: Partial<Milestone> = {}): Milestone =>
  ({ kind: 'milestone', id, name, text, need, family, axes, boards, metric, ...extra });
const A = (id: string, name: string, text: string, family: Family, axes: Record<string, number>, boards: BoardId[], drift: Award['drift'], metric: Award['metric'], extra: Partial<Award> = {}): Award =>
  ({ kind: 'award', id, name, text, family, axes, boards, drift, metric, ...extra });

export const MILESTONES: Milestone[] = [
  // Tharsis
  M('terraformer', 'Terraformer', 'TR of 35', 35, 'tr', { tr: 1 }, ['tharsis'], (s, pid) => P(s, pid).tr),
  M('mayor', 'Mayor', '3 cities', 3, 'tiles', { 'tile.city': 0.6, tile: 0.4 }, ['tharsis'], (s, pid) => cities(s, { pid }).length),
  M('gardener', 'Gardener', '3 greeneries', 3, 'tiles', { 'tile.greenery': 0.6, tile: 0.4 }, ['tharsis'], (s, pid) => greeneries(s, pid).length),
  M('builder', 'Builder', '8 building tags', 8, 'tags', { 'tag.building': 1 }, ['tharsis'], (s, pid) => tagCount(s, pid, 'building')),
  M('planner', 'Planner', '16 cards in hand', 16, 'cards', { hand: 1 }, ['tharsis'], (s, pid) => P(s, pid).hand.length),
  // Hellas
  M('diversifier', 'Diversifier', '8 different tags in play', 8, 'tags', { 'tag.variety': 0.7, 'tag.any': 0.3 }, ['hellas'], distinctTags),
  M('tactician', 'Tactician', '5 cards with requirements in play (not events)', 5, 'cards', { 'card.req': 0.8, 'card.count': 0.2 }, ['hellas'], withReq),
  M('polar-explorer', 'Polar Explorer', '3 tiles on the two bottom rows', 3, 'tiles', { 'tile.south': 0.6, tile: 0.4 }, ['hellas'], (s, pid) => realTiles(s, pid).filter((x) => x.row >= rows(s) - 2).length),
  M('energizer', 'Energizer', '6 energy production', 6, 'production', { 'prod.energy': 1 }, ['hellas'], (s, pid) => P(s, pid).prod.energy),
  M('rim-settler', 'Rim Settler', '3 Jovian tags', 3, 'tags', { 'tag.jovian': 0.8, 'tag.space': 0.2 }, ['hellas'], (s, pid) => tagCount(s, pid, 'jovian')),
  // Elysium
  M('generalist', 'Generalist', 'Raised all 6 productions by at least 1', 6, 'production', { 'prod.variety': 0.8, 'prod.any': 0.2 }, ['elysium'],
    (s, pid) => RESOURCES.filter((r) => P(s, pid).prod[r] > (s.options.corporateEra ? 0 : 1)).length),
  M('specialist', 'Specialist', '10 production of one resource', 10, 'production', { 'prod.any': 0.7, 'prod.mc': 0.3 }, ['elysium'], (s, pid) => Math.max(...RESOURCES.map((r) => P(s, pid).prod[r]))),
  M('ecologist', 'Ecologist', '4 bio tags (plant, microbe, animal)', 4, 'tags', { 'tag.bio': 0.4, 'tag.plant': 0.25, 'tag.microbe': 0.15, 'tag.animal': 0.2 }, ['elysium'], (s, pid) => tags(s, pid, ['plant', 'microbe', 'animal'])),
  M('tycoon', 'Tycoon', '15 project cards in play (not events)', 15, 'cards', { 'card.count': 0.7, 'card.project': 0.3 }, ['elysium'], (s, pid) => projects(s, pid).length),
  M('legend', 'Legend', '5 events played', 5, 'cards', { 'card.event': 1 }, ['elysium'], eventsPlayed),
  // Utopia Planitia
  M('manager', 'Manager', '3 special tiles', 3, 'tiles', { 'tile.special': 0.7, tile: 0.3 }, ['utopia'], (s, pid) => realTiles(s, pid).filter(isSpecial).length),
  M('trader', 'Trader', '3 different kinds of resource on your cards', 3, 'resources', { 'res.cardtypes': 0.7, 'res.card': 0.3 }, ['utopia'], resTypes),
  M('metallurgist', 'Metallurgist', '6 steel and titanium production combined', 6, 'production', { 'prod.steel': 0.5, 'prod.titanium': 0.5 }, ['utopia'], (s, pid) => prod(s, pid, ['steel', 'titanium'])),
  M('researcher', 'Researcher', '4 science tags', 4, 'tags', { 'tag.science': 1 }, ['utopia'], (s, pid) => tagCount(s, pid, 'science')),
  // Terra Cimmeria
  M('architect', 'Architect', '3 city tags', 3, 'tags', { 'tag.city': 0.6, 'tile.city': 0.4 }, ['cimmeria'], (s, pid) => tagCount(s, pid, 'city')),
  M('coastguard', 'Coastguard', '3 tiles next to oceans', 3, 'tiles', { 'tile.coast': 0.6, tile: 0.4 }, ['cimmeria'], (s, pid) => realTiles(s, pid).filter((x) => adjOcean(s, x)).length),
  M('forester', 'Forester', '3 plant production', 3, 'production', { 'prod.plants': 0.8, 'tile.greenery': 0.2 }, ['cimmeria'], (s, pid) => P(s, pid).prod.plants),
  M('fundraiser', 'Fundraiser', '12 M€ production', 12, 'production', { 'prod.mc': 1 }, ['cimmeria'], (s, pid) => P(s, pid).prod.mc),
  // Amazonis Planitia
  M('terran', 'Terran', '5 Earth tags', 5, 'tags', { 'tag.earth': 1 }, ['amazonis'], (s, pid) => tagCount(s, pid, 'earth')),
  M('landshaper', 'Landshaper', 'A city, a greenery and a special tile', 3, 'tiles', { 'tile.city': 0.3, 'tile.greenery': 0.3, 'tile.special': 0.3, tile: 0.1 }, ['amazonis'],
    (s, pid) => (cities(s, { pid, marsOnly: true }).length ? 1 : 0) + (greeneries(s, pid).length ? 1 : 0) + (realTiles(s, pid).some(isSpecial) ? 1 : 0)),
  M('merchant', 'Merchant', '3 of every standard resource after paying for this', 6, 'resources', { 'res.std': 0.8, 'res.mc': 0.2 }, ['amazonis'],
    (s, pid) => RESOURCES.filter((r) => P(s, pid).res[r] >= (r === 'mc' ? 3 + MILESTONE_COST : 3)).length),
  M('sponsor', 'Sponsor', '3 project cards costing 20 M€ or more', 3, 'cards', { 'card.expensive': 1 }, ['amazonis'], (s, pid) => projects(s, pid).filter((id) => CARDS[id].cost >= 20).length),
  // Vastitas Borealis
  M('agronomist', 'Agronomist', '4 plant tags', 4, 'tags', { 'tag.plant': 0.7, 'tag.bio': 0.3 }, ['vastitas'], (s, pid) => tagCount(s, pid, 'plant')),
  M('engineer', 'Engineer', '10 energy and heat production combined', 10, 'production', { 'prod.energy': 0.5, 'prod.heat': 0.5 }, ['vastitas'], (s, pid) => prod(s, pid, ['energy', 'heat'])),
  M('spacefarer', 'Spacefarer', '4 space tags', 4, 'tags', { 'tag.space': 1 }, ['vastitas'], (s, pid) => tagCount(s, pid, 'space')),
  M('geologist', 'Geologist', '3 tiles on or next to volcanic areas', 3, 'tiles', { 'tile.volcanic': 0.6, tile: 0.4 }, ['vastitas'],
    (s, pid) => realTiles(s, pid).filter((x) => x.volcanic || neighbours(s.board, x.id).some((n) => n.volcanic)).length, { unavailable: noVolcanoes }),
  M('farmer', 'Farmer', '5 animals and microbes on your cards', 5, 'resources', { 'res.animal': 0.35, 'res.microbe': 0.35, 'res.card': 0.3 }, ['vastitas'], (s, pid) => resOn(s, pid, ['animal', 'microbe'])),
  // need expansions
  M('pioneer', 'Pioneer', '4 colonies', 4, 'tiles', { colony: 1 }, ['utopia'], (s, pid) => colonyCount(s, pid), { needs: 'colonies' }),
  M('planetologist', 'Planetologist', '2 Earth, 2 Venus and 2 Jovian tags', 6, 'tags', { 'tag.venus': 0.4, 'tag.earth': 0.3, 'tag.jovian': 0.3 }, ['cimmeria'],
    (s, pid) => Math.min(6, (['earth', 'venus', 'jovian'] as Tag[]).reduce((a, t) => a + Math.min(2, tagCount(s, pid, t)), 0) + tagCount(s, pid, 'wild')), { needs: 'venus' }),
  M('lobbyist', 'Lobbyist', 'All 7 delegates out of your reserve', 7, 'tr', { delegate: 1 }, ['amazonis'], (s, pid) => delegatesOut(s, pid), { needs: 'turmoil' }),
  M('hoverlord', 'Hoverlord', '7 floaters on your cards', 7, 'resources', { 'res.floater': 0.8, 'res.card': 0.2 }, [], (s, pid) => resOnCards(s, pid, 'floater'), { needs: 'venus' }),
];

export const AWARDS: Award[] = [
  // Tharsis
  A('landlord', 'Landlord', 'Most tiles on Mars', 'tiles', { tile: 0.6, 'tile.greenery': 0.25, 'tile.city': 0.15 }, ['tharsis'], { sd: 1.25, widen: 0.05 }, (s, pid) => marsTiles(s, pid).length),
  A('banker', 'Banker', 'Highest M€ production', 'production', { 'prod.mc': 1 }, ['tharsis'], { sd: 2.1, widen: 0.04 }, (s, pid) => P(s, pid).prod.mc),
  A('scientist', 'Scientist', 'Most science tags', 'tags', { 'tag.science': 1 }, ['tharsis'], { sd: 0.6, widen: 0.02 }, (s, pid) => tagCount(s, pid, 'science')),
  A('thermalist', 'Thermalist', 'Most heat', 'resources', { 'res.heat': 0.7, 'prod.heat': 0.3 }, ['tharsis'], { sd: 4.2, widen: 0 }, (s, pid) => P(s, pid).res.heat, { project: 'heat' }),
  A('miner', 'Miner', 'Most steel + titanium', 'resources', { 'res.steel': 0.4, 'res.titanium': 0.3, 'res.metal': 0.2, 'prod.steel': 0.05, 'prod.titanium': 0.05 }, ['tharsis'], { sd: 2.6, widen: 0 },
    (s, pid) => P(s, pid).res.steel + P(s, pid).res.titanium, { project: 'metal' }),
  // Hellas
  A('cultivator', 'Cultivator', 'Most greeneries', 'tiles', { 'tile.greenery': 0.6, tile: 0.4 }, ['hellas'], { sd: 1.4, widen: 0.05 }, (s, pid) => greeneries(s, pid).length),
  A('magnate', 'Magnate', 'Most automated (green) cards in play', 'cards', { 'card.green': 0.5, 'card.project': 0.2, 'card.count': 0.3 }, ['hellas'], { sd: 1.0, widen: 0.04 },
    (s, pid) => P(s, pid).played.filter((id) => CARDS[id].type === 'automated').length),
  A('space-baron', 'Space Baron', 'Most space tags', 'tags', { 'tag.space': 1 }, ['hellas'], { sd: 0.7, widen: 0.03 }, (s, pid) => tagCount(s, pid, 'space')),
  A('excentric', 'Excentric', 'Most resources on cards', 'resources', { 'res.card': 0.7, 'res.animal': 0.15, 'res.microbe': 0.15 }, ['hellas'], { sd: 1.8, widen: 0.06 }, (s, pid) => resOn(s, pid)),
  A('contractor', 'Contractor', 'Most building tags', 'tags', { 'tag.building': 1 }, ['hellas'], { sd: 0.85, widen: 0.04 }, (s, pid) => tagCount(s, pid, 'building')),
  // Elysium
  A('celebrity', 'Celebrity', 'Most project cards costing 20 M€ or more in play', 'cards', { 'card.expensive': 1 }, ['elysium'], { sd: 0.55, widen: 0.03 },
    (s, pid) => projects(s, pid).filter((id) => CARDS[id].cost >= 20).length),
  A('industrialist', 'Industrialist', 'Most steel + energy', 'resources', { 'res.steel': 0.3, 'res.metal': 0.2, 'prod.steel': 0.15, 'prod.energy': 0.25, 'res.energy': 0.1 }, ['elysium'], { sd: 1.4, widen: 0 },
    (s, pid) => P(s, pid).res.steel + P(s, pid).res.energy, { project: 'steelEnergy' }),
  A('desert-settler', 'Desert Settler', 'Most tiles south of the equator', 'tiles', { 'tile.south': 0.6, tile: 0.4 }, ['elysium'], { sd: 1.2, widen: 0.05 },
    (s, pid) => realTiles(s, pid).filter((x) => x.row > (rows(s) - 1) / 2).length),
  A('estate-dealer', 'Estate Dealer', 'Most tiles next to oceans', 'tiles', { 'tile.coast': 0.6, tile: 0.4 }, ['elysium'], { sd: 1.0, widen: 0.05 }, (s, pid) => realTiles(s, pid).filter((x) => adjOcean(s, x)).length),
  A('benefactor', 'Benefactor', 'Highest TR', 'tr', { tr: 1 }, ['elysium'], { sd: 2.3, widen: 0.03 }, (s, pid) => P(s, pid).tr),
  // Utopia Planitia
  A('suburbian', 'Suburbian', 'Most tiles along the map’s edge', 'tiles', { 'tile.edge': 0.6, tile: 0.4 }, ['utopia'], { sd: 0.95, widen: 0.05 }, (s, pid) => realTiles(s, pid).filter((x) => x.edge).length),
  A('investor', 'Investor', 'Most Earth tags', 'tags', { 'tag.earth': 1 }, ['utopia'], { sd: 0.4, widen: 0.03 }, (s, pid) => tagCount(s, pid, 'earth')),
  A('botanist', 'Botanist', 'Highest plant production', 'production', { 'prod.plants': 0.8, 'tile.greenery': 0.2 }, ['utopia'], { sd: 1.0, widen: 0.04 }, (s, pid) => P(s, pid).prod.plants),
  A('incorporator', 'Incorporator', 'Most project cards costing 10 M€ or less in play', 'cards', { 'card.cheap': 0.8, 'card.count': 0.2 }, ['utopia'], { sd: 1.1, widen: 0.04 },
    (s, pid) => projects(s, pid).filter((id) => CARDS[id].cost <= 10).length),
  A('metropolist', 'Metropolist', 'Most cities', 'tiles', { 'tile.city': 0.6, tile: 0.4 }, ['utopia'], { sd: 0.7, widen: 0.04 }, (s, pid) => cities(s, { pid }).length),
  // Terra Cimmeria
  A('electrician', 'Electrician', 'Most power tags', 'tags', { 'tag.power': 0.8, 'prod.energy': 0.2 }, ['cimmeria'], { sd: 0.4, widen: 0.03 }, (s, pid) => tagCount(s, pid, 'power')),
  A('founder', 'Founder', 'Most tiles next to special tiles', 'tiles', { 'tile.special': 0.4, tile: 0.6 }, ['cimmeria'], { sd: 0.8, widen: 0.04 }, (s, pid) => {
    const near = new Set(s.board.filter(isSpecial).flatMap((x) => neighbours(s.board, x.id).map((n) => n.id)));
    return realTiles(s, pid).filter((x) => near.has(x.id)).length;
  }),
  A('mogul', 'Mogul', 'Highest production of everything except M€', 'production', { 'prod.variety': 0.3, 'prod.any': 0.4, 'prod.steel': 0.1, 'prod.titanium': 0.1, 'prod.plants': 0.1 }, ['cimmeria'], { sd: 2.0, widen: 0.04 },
    (s, pid) => prod(s, pid, ['steel', 'titanium', 'plants', 'energy', 'heat'])),
  A('zoologist', 'Zoologist', 'Most animals and microbes on cards', 'resources', { 'res.animal': 0.35, 'res.microbe': 0.35, 'res.card': 0.3 }, ['cimmeria'], { sd: 3.5, widen: 0.08 }, (s, pid) => resOn(s, pid, ['animal', 'microbe'])),
  A('forecaster', 'Forecaster', 'Most cards with requirements in play (not events)', 'cards', { 'card.req': 0.8, 'card.count': 0.2 }, ['cimmeria'], { sd: 1.2, widen: 0.04 }, withReq),
  // Amazonis Planitia
  A('collector', 'Collector', 'Most different kinds of resource, in stock and on cards', 'resources', { 'res.std': 0.5, 'res.cardtypes': 0.5 }, ['amazonis'], { sd: 0.9, widen: 0 },
    (s, pid) => RESOURCES.filter((r) => P(s, pid).res[r] > 0).length + resTypes(s, pid)),
  A('innovator', 'Innovator', 'Most cards played, events included', 'cards', { 'card.count': 0.8, 'card.event': 0.2 }, ['amazonis'], { sd: 2.0, widen: 0.04 }, (s, pid) => P(s, pid).played.length),
  A('constructor', 'Constructor', 'Most cities (and colonies, with Colonies)', 'tiles', { 'tile.city': 0.6, tile: 0.4 }, ['amazonis'], { sd: 0.8, widen: 0.04 }, (s, pid) => cities(s, { pid }).length + colonyCount(s, pid)),
  A('manufacturer', 'Manufacturer', 'Highest steel and heat production combined', 'production', { 'prod.steel': 0.5, 'prod.heat': 0.5 }, ['amazonis'], { sd: 1.0, widen: 0.04 }, (s, pid) => prod(s, pid, ['steel', 'heat'])),
  A('physicist', 'Physicist', 'Most science and space tags combined', 'tags', { 'tag.science': 0.5, 'tag.space': 0.5 }, ['amazonis'], { sd: 1.1, widen: 0.03 }, (s, pid) => tags(s, pid, ['science', 'space'])),
  // Vastitas Borealis
  A('traveller', 'Traveller', 'Most Jovian and Earth tags combined', 'tags', { 'tag.jovian': 0.5, 'tag.earth': 0.5 }, ['vastitas'], { sd: 0.6, widen: 0.03 }, (s, pid) => tags(s, pid, ['jovian', 'earth'])),
  A('landscaper', 'Landscaper', 'Largest group of your own tiles touching each other', 'tiles', { 'tile.cluster': 0.5, tile: 0.5 }, ['vastitas'], { sd: 1.25, widen: 0.05 }, largestGroup),
  A('highlander', 'Highlander', 'Most tiles not next to oceans', 'tiles', { 'tile.inland': 0.6, tile: 0.4 }, ['vastitas'], { sd: 1.05, widen: 0.05 }, (s, pid) => realTiles(s, pid).filter((x) => !adjOcean(s, x)).length),
  A('promoter', 'Promoter', 'Most events played', 'cards', { 'card.event': 1 }, ['vastitas'], { sd: 0.7, widen: 0.04 }, eventsPlayed),
  A('blacksmith', 'Blacksmith', 'Highest steel and titanium production combined', 'production', { 'prod.steel': 0.5, 'prod.titanium': 0.5 }, ['vastitas'], { sd: 0.5, widen: 0.04 }, (s, pid) => prod(s, pid, ['steel', 'titanium'])),
  // Venus Next
  A('venuphile', 'Venuphile', 'Most Venus tags', 'tags', { 'tag.venus': 1 }, [], { sd: 0.6, widen: 0.03 }, (s, pid) => tagCount(s, pid, 'venus'), { needs: 'venus' }),
];

export const MILESTONE_COST = 8;

/** Milestones and awards that count tags, and which (CPUs value those tags while the race is on). */
const TAG_RACE_LIST: [string, Tag[]][] = Object.entries({
  builder: ['building'], 'rim-settler': ['jovian'], ecologist: ['plant', 'microbe', 'animal'], researcher: ['science'], architect: ['city'],
  terran: ['earth'], agronomist: ['plant'], spacefarer: ['space'], planetologist: ['earth', 'venus', 'jovian'],
  scientist: ['science'], venuphile: ['venus'], 'space-baron': ['space'], contractor: ['building'], investor: ['earth'], electrician: ['power'], physicist: ['science', 'space'], traveller: ['jovian', 'earth'],
} as Record<string, Tag[]>);
// a Map, not an object: ids like 'constructor' must not hit Object.prototype
const TAG_RACES = new Map(TAG_RACE_LIST);
export const tagRace = (id: string): Tag[] | undefined => TAG_RACES.get(id);

const BY_ID = new Map<string, MADef>([...MILESTONES, ...AWARDS].map((d) => [d.id, d]));
export const maDef = (id: string): MADef | undefined => BY_ID.get(id);
export const milestoneDef = (id: string) => BY_ID.get(id) as Milestone;
export const awardDef = (id: string) => BY_ID.get(id) as Award;

/** The milestones and awards in play (Tharsis' for games saved before maps existed). */
export const gameMilestones = (s: Pick<GameState, 'options'>): Milestone[] => (s.options.milestones ?? BOARDS.tharsis.milestones).map(milestoneDef);
export const gameAwards = (s: Pick<GameState, 'options'>): Award[] => (s.options.awards ?? BOARDS.tharsis.awards).map(awardDef);
export const inGame = (s: Pick<GameState, 'options'>, id: string) => (s.options.milestones ?? BOARDS.tharsis.milestones).includes(id) || (s.options.awards ?? BOARDS.tharsis.awards).includes(id);

// ---------------- conflicts and balanced draws ----------------
/** How alike two milestones/awards are, 0 (unrelated) to 9 (the same race). */
export function conflict(a: string, b: string): number {
  const x = maDef(a)!.axes, y = maDef(b)!.axes;
  let o = 0;
  for (const k in x) if (y[k]) o += Math.min(x[k], y[k]);
  return Math.round(o * 9);
}

export interface DrawRules {
  /** no two may be more alike than this (0–9) */
  maxPair: number;
  /** sum over all 45 pairs */
  maxTotal: number;
  /** at most this many of one kind (tiles, tags, cards…) among the ten */
  maxFamily: number;
  /** …and among the five milestones or the five awards */
  maxFamilySide: number;
}
export const BALANCED: DrawRules = { maxPair: 4, maxTotal: 22, maxFamily: 3, maxFamilySide: 2 };

const EX_NAME: Record<Expansion, string> = { prelude: 'Prelude', venus: 'Venus Next', colonies: 'Colonies', turmoil: 'Turmoil' };

/** Ids that can be picked on this board with these expansions, and why the others can't. */
export function availability(board: BoardId, id: string, ex: Expansions = {}): string | null {
  const d = maDef(id);
  if (d?.needs && !ex[d.needs]) return `Needs ${EX_NAME[d.needs]}`;
  return d?.unavailable?.(board) ?? null;
}

export interface MASelection { milestones: string[]; awards: string[] }
export interface Slots { milestones: (string | null)[]; awards: (string | null)[] }

/** Problems with a set: pairs that are too alike and kinds of play that are crowded. */
export function selectionIssues(sel: MASelection, rules: DrawRules = BALANCED): { pairs: [string, string, number][]; crowded: Family[]; total: number } {
  const all = [...sel.milestones, ...sel.awards];
  const pairs: [string, string, number][] = [];
  let total = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const c = conflict(all[i], all[j]);
      total += c;
      if (c > rules.maxPair) pairs.push([all[i], all[j], c]);
    }
  }
  const count = (ids: string[]) => {
    const m = new Map<Family, number>();
    for (const id of ids) m.set(maDef(id)!.family, (m.get(maDef(id)!.family) ?? 0) + 1);
    return m;
  };
  const crowded = new Set<Family>();
  for (const [f, n] of count(all)) if (n > rules.maxFamily) crowded.add(f);
  for (const side of [sel.milestones, sel.awards]) for (const [f, n] of count(side)) if (n > rules.maxFamilySide) crowded.add(f);
  return { pairs, crowded: [...crowded], total };
}

/**
 * Fills the empty slots with a random, balanced choice that works around the filled ones.
 * Filled slots are kept even if they clash (the players chose them). Deterministic for a
 * given random source. Rules are relaxed step by step if a draw can't satisfy them.
 */
export function drawMA(board: BoardId, slots: Slots, rand: () => number, rules: DrawRules = BALANCED, ex: Expansions = {}): MASelection {
  const fixed = [...slots.milestones, ...slots.awards].filter((x): x is string => !!x);
  const pool = (defs: MADef[]) => defs.filter((d) => !fixed.includes(d.id) && !availability(board, d.id, ex)).map((d) => d.id);
  const relax = [rules, { ...rules, maxTotal: rules.maxTotal + 6 }, { ...rules, maxPair: rules.maxPair + 1, maxTotal: rules.maxTotal + 8, maxFamily: rules.maxFamily + 1 },
    { maxPair: 9, maxTotal: 999, maxFamily: 10, maxFamilySide: 5 }];
  for (const r of relax) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const out = tryDraw(slots, pool(MILESTONES), pool(AWARDS), rand, r);
      if (out) return out;
    }
  }
  throw new Error('Could not draw milestones and awards');
}

function tryDraw(slots: Slots, mPool: string[], aPool: string[], rand: () => number, r: DrawRules): MASelection | null {
  const ms = [...slots.milestones], as = [...slots.awards];
  const fixed = new Set([...ms, ...as].filter((x): x is string => !!x));
  const shuffled = (xs: string[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const mq = shuffled(mPool), aq = shuffled(aPool);
  // fill alternately (milestone or award at random) so neither side grabs every good slot
  const empty = () => ms.filter((x) => !x).length + as.filter((x) => !x).length;
  while (empty()) {
    const pickM = as.every(Boolean) || (ms.some((x) => !x) && rand() < 0.5);
    const side = pickM ? ms : as, q = pickM ? mq : aq;
    let placed = false;
    while (q.length) {
      const id = q.shift()!;
      const i = side.indexOf(null);
      side[i] = id;
      if (fits(ms, as, fixed, r)) { placed = true; break; }
      side[i] = null;
    }
    if (!placed) return null;
  }
  return { milestones: ms as string[], awards: as as string[] };
}

/** Whether the drawn picks keep to the rules; clashes among the players' own picks don't count. */
function fits(ms: (string | null)[], as: (string | null)[], fixed: Set<string>, r: DrawRules): boolean {
  const m = ms.filter((x): x is string => !!x), a = as.filter((x): x is string => !!x);
  const all = [...m, ...a];
  let total = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (fixed.has(all[i]) && fixed.has(all[j])) continue;
      const c = conflict(all[i], all[j]);
      if (c > r.maxPair) return false;
      total += c;
    }
  }
  if (total > r.maxTotal) return false;
  const crowded = (ids: string[], max: number) => {
    const n = new Map<Family, { all: number; drawn: number }>();
    for (const id of ids) {
      const f = maDef(id)!.family;
      const e = n.get(f) ?? { all: 0, drawn: 0 };
      e.all++;
      if (!fixed.has(id)) e.drawn++;
      n.set(f, e);
    }
    return [...n.values()].some((e) => e.all > max && e.drawn > 0);
  };
  return !crowded(all, r.maxFamily) && !crowded(m, r.maxFamilySide) && !crowded(a, r.maxFamilySide);
}

/**
 * The board's own set, with slots for milestones/awards that need missing expansions
 * filled by a balanced draw.
 */
export function boardMA(board: BoardId, rand: () => number, ex: Expansions = {}): MASelection {
  const b = BOARDS[board];
  // milestones that need a missing expansion leave a slot for a balanced draw
  const pad = (xs: string[]) => { const kept = xs.map((id) => (availability(board, id, ex) ? null : id)); return [...kept, ...Array(Math.max(0, 5 - kept.length)).fill(null)]; };
  return drawMA(board, { milestones: pad(b.milestones), awards: pad(b.awards) }, rand, BALANCED, ex);
}

/** Small seeded generator for setup draws (separate from the game's own random stream). */
export function setupRandom(seed: number): () => number {
  let t = (seed ^ 0x5bd1e995) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
