// Card catalogue: base game + Corporate Era. Numbers (costs, tags, requirements, VP) follow the
// published game; effect wording is our own. Effects are returned as Op lists evaluated at play
// time, so "per tag" / "per city" amounts are computed against the state when the card resolves.
import type { CardRes, CardType, GameState, Op, Res, Space, Tag } from './types';
import { adjacentCount, cardSpace, cities, eventsPlayed, others, P, tagCount } from './helpers';

export interface Req {
  temp?: number; tempMax?: number;
  oxy?: number; oxyMax?: number;
  oceans?: number; oceansMax?: number;
  tags?: Partial<Record<Tag, number>>;
  prod?: Partial<Record<Res, number>>;
  greeneries?: number;
  citiesAll?: number;
}

export interface CardAction {
  text: string;
  mc?: number; // M€ cost of the action
  steel?: boolean; // steel may pay the M€ cost
  titanium?: boolean;
  can: (s: GameState, pid: number, id: string) => boolean;
  run: (s: GameState, pid: number, id: string) => Op[];
}

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  tags: Tag[];
  text: string;
  set: 'base' | 'corp';
  req?: Req;
  vp?: number | ((s: GameState, pid: number, id: string) => number);
  vpText?: string;
  resource?: CardRes;
  play?: (s: GameState, pid: number, id: string) => Op[];
  canPlay?: (s: GameState, pid: number) => boolean;
  action?: CardAction;
  discount?: { tag?: Tag; n: number };
  reqBonus?: number;
  /** Fires when any player (owner or not) plays a card. */
  onCard?: (s: GameState, owner: number, player: number, card: CardDef) => Op[];
  /** Fires when any player places a tile. */
  onTile?: (s: GameState, owner: number, placer: number, sp: Space) => Op[];
  onSP?: (s: GameState, owner: number, cost: number) => Op[];
  protectedRes?: boolean;
  // corporations
  startMC?: number;
  firstAction?: { text: string; ops: Op[] };
}

// ---------- op shorthands ----------
const R = (r: Res, n: number): Op => ({ k: 'res', r, n });
const PR = (r: Res, n: number): Op => ({ k: 'prod', r, n });
const TEMP = (n = 1): Op => ({ k: 'temp', n });
const OXY = (n = 1): Op => ({ k: 'oxy', n });
const TR = (n: number): Op => ({ k: 'tr', n });
const OCEAN: Op = { k: 'ocean' };
const CITY: Op = { k: 'tile', tile: 'city', rule: 'city' };
const GREEN: Op = { k: 'tile', tile: 'greenery', rule: 'greenery' };
const DRAW = (n: number): Op => ({ k: 'draw', n });
const REMOVE_PLANTS = (n: number): Op => ({ k: 'removeAny', r: 'plants', n });
const DEC = (r: Res, n: number, gain = false): Op => ({ k: 'decProd', r, n, gain });
const ADD_THIS = (n: number): Op => ({ k: 'addRes', n, target: 'this' });
const ADD_OTHER = (rtype: CardRes, n: number): Op => ({ k: 'addRes', n, rtype, target: 'other' });
const CHOOSE = (title: string, options: { label: string; ops: Op[]; ok?: boolean }[]): Op => ({
  k: 'choose', title, options: options.map((o) => ({ ...o, ok: o.ok ?? true })),
});

const res = (s: GameState, pid: number, id: string) => P(s, pid).cardRes[id] ?? 0;
const perRes = (per: number) => (s: GameState, pid: number, id: string) => Math.floor(res(s, pid, id) / per);
const hasCardWith = (s: GameState, pid: number, rtype: CardRes, exclude?: string) =>
  P(s, pid).played.some((c) => c !== exclude && CARDS[c].resource === rtype);
const jovianVP = (s: GameState, pid: number) => tagCount(s, pid, 'jovian');
const anyProd = (s: GameState, r: Res, n: number) => s.players.some((p) => (r === 'mc' ? p.prod.mc - n >= -5 : p.prod[r] >= n));

const list: Omit<CardDef, 'id' | 'set'>[] = [];
const corpEra: Omit<CardDef, 'id' | 'set'>[] = [];
const add = (c: Omit<CardDef, 'id' | 'set'>) => list.push(c);
const addCE = (c: Omit<CardDef, 'id' | 'set'>) => corpEra.push(c);

// ================= Corporations =================
const corpBase: Omit<CardDef, 'id' | 'set'>[] = [
  { name: 'Beginner Corporation', type: 'corp', cost: 0, tags: [], startMC: 42, text: 'Start with 42 M€. You keep all 10 starting cards for free.' },
  {
    name: 'CrediCor', type: 'corp', cost: 0, tags: [], startMC: 57,
    text: 'Start with 57 M€. Whenever you play a card or standard project costing 20 M€ or more, gain 4 M€.',
    onCard: (s, owner, player, card) => (owner === player && card.cost >= 20 ? [R('mc', 4)] : []),
    onSP: (s, owner, cost) => (cost >= 20 ? [R('mc', 4)] : []),
  },
  {
    name: 'EcoLine', type: 'corp', cost: 0, tags: ['plant'], startMC: 36,
    text: 'Start with 36 M€, 3 plants and 2 plant production. Greeneries cost you 7 plants instead of 8.',
    play: () => [PR('plants', 2), R('plants', 3)],
  },
  {
    name: 'Helion', type: 'corp', cost: 0, tags: ['space'], startMC: 42,
    text: 'Start with 42 M€ and 3 heat production. You may spend heat as M€.',
    play: () => [PR('heat', 3)],
  },
  {
    name: 'Interplanetary Cinematics', type: 'corp', cost: 0, tags: ['building'], startMC: 30,
    text: 'Start with 30 M€ and 20 steel. Whenever you play an event, gain 2 M€.',
    play: () => [R('steel', 20)],
    onCard: (s, owner, player, card) => (owner === player && card.type === 'event' ? [R('mc', 2)] : []),
  },
  {
    name: 'Inventrix', type: 'corp', cost: 0, tags: ['science'], startMC: 45, reqBonus: 2,
    text: 'Start with 45 M€. First action: draw 3 cards. Global requirements are ±2 steps for you.',
    firstAction: { text: 'Draw 3 cards', ops: [DRAW(3)] },
  },
  {
    name: 'Mining Guild', type: 'corp', cost: 0, tags: ['building', 'building'], startMC: 30,
    text: 'Start with 30 M€, 5 steel and 1 steel production. When you gain steel or titanium from a placement bonus, +1 steel production.',
    play: () => [PR('steel', 1), R('steel', 5)],
    onTile: (s, owner, placer, sp) => (owner === placer && sp.bonus.some((b) => b === 'steel' || b === 'titanium') ? [PR('steel', 1)] : []),
  },
  {
    name: 'PhoboLog', type: 'corp', cost: 0, tags: ['space'], startMC: 23,
    text: 'Start with 23 M€ and 10 titanium. Your titanium is worth 1 M€ extra.',
    play: () => [R('titanium', 10)],
  },
  {
    name: 'Tharsis Republic', type: 'corp', cost: 0, tags: ['building'], startMC: 40,
    text: 'Start with 40 M€. First action: place a city. When any city is placed on Mars, +1 M€ production; when you place a city, gain 3 M€.',
    firstAction: { text: 'Place a city', ops: [CITY] },
    onTile: (s, owner, placer, sp) => {
      if (sp.tile?.kind !== 'city') return [];
      const ops: Op[] = [];
      if (sp.type !== 'off') ops.push(PR('mc', 1));
      if (owner === placer) ops.push(R('mc', 3));
      return ops;
    },
  },
  {
    name: 'ThorGate', type: 'corp', cost: 0, tags: ['power'], startMC: 48, discount: { tag: 'power', n: 3 },
    text: 'Start with 48 M€ and 1 energy production. Power cards and the Power Plant project cost you 3 M€ less.',
    play: () => [PR('energy', 1)],
  },
  {
    name: 'United Nations Mars Initiative', type: 'corp', cost: 0, tags: ['earth'], startMC: 40,
    text: 'Start with 40 M€. Action: if your TR rose this generation, pay 3 M€ to raise it 1 more step.',
    action: {
      text: 'Pay 3 M€: +1 TR (only if your TR rose this generation)', mc: 3,
      can: (s, pid) => P(s, pid).trRaisedThisGen,
      run: () => [TR(1)],
    },
  },
];
const corpCE: Omit<CardDef, 'id' | 'set'>[] = [
  {
    name: 'Saturn Systems', type: 'corp', cost: 0, tags: ['jovian'], startMC: 42,
    text: 'Start with 42 M€ and 1 titanium production. Whenever anyone plays a Jovian tag, +1 M€ production.',
    play: () => [PR('titanium', 1)],
    onCard: (s, owner, player, card) => {
      const n = card.tags.filter((t) => t === 'jovian').length;
      return n ? [PR('mc', n)] : [];
    },
  },
  {
    name: 'Teractor', type: 'corp', cost: 0, tags: ['earth'], startMC: 60, discount: { tag: 'earth', n: 3 },
    text: 'Start with 60 M€. Earth cards cost you 3 M€ less.',
  },
];

// ================= Base game projects =================
add({ name: 'Adaptation Technology', type: 'active', cost: 12, tags: ['science'], vp: 1, reqBonus: 2, text: 'Your global requirements are ±2 steps.' });
add({ name: 'Adapted Lichen', type: 'automated', cost: 9, tags: ['plant'], text: '+1 plant production.', play: () => [PR('plants', 1)] });
add({ name: 'Advanced Ecosystems', type: 'automated', cost: 11, tags: ['plant', 'microbe', 'animal'], vp: 3, req: { tags: { plant: 1, microbe: 1, animal: 1 } }, text: 'Needs a plant, microbe and animal tag.' });
add({ name: 'Aerobraked Ammonia Asteroid', type: 'event', cost: 26, tags: ['space'], text: '+3 heat and +1 plant production. Add 2 microbes to another card.', play: () => [PR('heat', 3), PR('plants', 1), ADD_OTHER('microbe', 2)] });
add({
  name: 'Ants', type: 'active', cost: 9, tags: ['microbe'], resource: 'microbe', vp: perRes(2), vpText: '1 VP per 2 microbes', req: { oxy: 4 },
  text: 'Action: take 1 microbe from any card and add it here.',
  action: {
    text: 'Move 1 microbe from any card to this card',
    can: (s, pid, id) => s.players.some((p) => p.played.some((c) => c !== id && CARDS[c].resource === 'microbe' && (p.cardRes[c] ?? 0) > 0 && (p.id === pid || !protects(s, p.id, 'microbe')))),
    run: (s, pid, id) => [{ k: 'removeCardRes', n: 1, rtype: 'microbe', gainTo: id }],
  },
});
add({
  name: 'Aquifer Pumping', type: 'active', cost: 18, tags: ['building'], text: 'Action: pay 8 M€ (steel may be used) to place an ocean.',
  action: { text: 'Pay 8 M€: place an ocean', mc: 8, steel: true, can: () => true, run: () => [OCEAN] },
});
add({ name: 'Algae', type: 'automated', cost: 10, tags: ['plant'], req: { oceans: 5 }, text: 'Gain 1 plant. +2 plant production.', play: () => [PR('plants', 2), R('plants', 1)] });
add({ name: 'Archaebacteria', type: 'automated', cost: 6, tags: ['microbe'], req: { tempMax: -18 }, text: '+1 plant production.', play: () => [PR('plants', 1)] });
add({
  name: 'Arctic Algae', type: 'active', cost: 12, tags: ['plant'], req: { tempMax: -12 }, text: 'Gain 1 plant. Whenever anyone places an ocean, gain 2 plants.',
  play: () => [R('plants', 1)], onTile: (s, owner, placer, sp) => (sp.tile?.kind === 'ocean' ? [R('plants', 2)] : []),
});
add({ name: 'Artificial Lake', type: 'automated', cost: 15, tags: ['building'], vp: 1, req: { temp: -6 }, text: 'Place an ocean on a land space (not an ocean area).', play: (s) => (s.oceans < 9 ? [{ k: 'tile', tile: 'ocean', rule: 'land' }] : []) });
add({
  name: 'Artificial Photosynthesis', type: 'automated', cost: 12, tags: ['science'], text: '+2 energy production, or +1 plant production.',
  play: () => [CHOOSE('Artificial Photosynthesis', [{ label: '+2 energy production', ops: [PR('energy', 2)] }, { label: '+1 plant production', ops: [PR('plants', 1)] }])],
});
add({ name: 'Asteroid', type: 'event', cost: 14, tags: ['space'], text: 'Raise temperature 1 step. Gain 2 titanium. Remove up to 3 plants from any player.', play: () => [TEMP(), R('titanium', 2), REMOVE_PLANTS(3)] });
add({ name: 'Asteroid Mining', type: 'automated', cost: 30, tags: ['jovian', 'space'], vp: 2, text: '+2 titanium production.', play: () => [PR('titanium', 2)] });
add({ name: 'Beam From A Thorium Asteroid', type: 'automated', cost: 32, tags: ['jovian', 'space', 'power'], vp: 1, req: { tags: { jovian: 1 } }, text: '+3 heat and +3 energy production.', play: () => [PR('heat', 3), PR('energy', 3)] });
add({ name: 'Big Asteroid', type: 'event', cost: 27, tags: ['space'], text: 'Raise temperature 2 steps. Gain 4 titanium. Remove up to 4 plants from any player.', play: () => [TEMP(2), R('titanium', 4), REMOVE_PLANTS(4)] });
add({ name: 'Biomass Combustors', type: 'automated', cost: 4, tags: ['power', 'building'], vp: -1, req: { oxy: 6 }, text: 'Decrease any plant production 1 step. +2 energy production.', canPlay: (s) => anyProd(s, 'plants', 1), play: () => [DEC('plants', 1), PR('energy', 2)] });
add({
  name: 'Birds', type: 'active', cost: 10, tags: ['animal'], resource: 'animal', vp: perRes(1), vpText: '1 VP per animal', req: { oxy: 13 },
  text: 'Decrease any plant production 2 steps. Action: add 1 animal here.', canPlay: (s) => anyProd(s, 'plants', 2), play: () => [DEC('plants', 2)],
  action: { text: 'Add 1 animal here', can: () => true, run: () => [ADD_THIS(1)] },
});
add({ name: 'Black Polar Dust', type: 'automated', cost: 15, tags: [], text: 'Place an ocean. −2 M€ production, +3 heat production.', play: () => [PR('mc', -2), PR('heat', 3), OCEAN] });
add({ name: 'Breathing Filters', type: 'automated', cost: 11, tags: ['science'], vp: 2, req: { oxy: 7 }, text: 'No effect beyond VP.' });
add({ name: 'Bushes', type: 'automated', cost: 10, tags: ['plant'], req: { temp: -10 }, text: 'Gain 2 plants. +2 plant production.', play: () => [PR('plants', 2), R('plants', 2)] });
add({
  name: 'Capital', type: 'automated', cost: 26, tags: ['city', 'building'], req: { oceans: 4 },
  vp: (s, pid, id) => { const sp = cardSpace(s, id); return sp ? adjacentCount(s, sp.id, (x) => x.tile?.kind === 'ocean') : 0; },
  vpText: '1 VP per adjacent ocean',
  text: '−2 energy, +5 M€ production. Place this special city.', play: (s, pid, id) => [PR('energy', -2), PR('mc', 5), { k: 'tile', tile: 'city', rule: 'city', card: id }],
});
add({ name: 'Carbonate Processing', type: 'automated', cost: 6, tags: ['building'], text: '−1 energy, +3 heat production.', play: () => [PR('energy', -1), PR('heat', 3)] });
add({ name: 'Cloud Seeding', type: 'automated', cost: 11, tags: [], req: { oceans: 3 }, text: '−1 M€ production, decrease any heat production 1 step, +2 plant production.', canPlay: (s) => anyProd(s, 'heat', 1), play: () => [PR('mc', -1), DEC('heat', 1), PR('plants', 2)] });
add({ name: 'Colonizer Training Camp', type: 'automated', cost: 8, tags: ['jovian', 'building'], vp: 2, req: { oxyMax: 5 }, text: 'No effect beyond VP.' });
add({ name: 'Comet', type: 'event', cost: 21, tags: ['space'], text: 'Raise temperature 1 step and place an ocean. Remove up to 3 plants from any player.', play: () => [TEMP(), OCEAN, REMOVE_PLANTS(3)] });
add({ name: 'Convoy From Europa', type: 'event', cost: 15, tags: ['space'], text: 'Place an ocean and draw 1 card.', play: () => [OCEAN, DRAW(1)] });
add({ name: 'Cupola City', type: 'automated', cost: 16, tags: ['city', 'building'], req: { oxyMax: 9 }, text: '−1 energy, +3 M€ production. Place a city.', play: () => [PR('energy', -1), PR('mc', 3), CITY] });
add({
  name: 'Decomposers', type: 'active', cost: 5, tags: ['microbe'], resource: 'microbe', vp: perRes(3), vpText: '1 VP per 3 microbes', req: { oxy: 3 },
  text: 'Whenever you play a plant, animal or microbe tag (this included), add 1 microbe here.',
  onCard: (s, owner, player, card) => {
    if (owner !== player) return [];
    const n = card.tags.filter((t) => t === 'plant' || t === 'animal' || t === 'microbe').length;
    return n ? [{ k: 'addRes', n, target: 'this' }] : [];
  },
});
add({ name: 'Deep Well Heating', type: 'automated', cost: 13, tags: ['power', 'building'], text: '+1 energy production. Raise temperature 1 step.', play: () => [PR('energy', 1), TEMP()] });
add({ name: 'Deimos Down', type: 'event', cost: 31, tags: ['space'], text: 'Raise temperature 3 steps. Gain 4 steel. Remove up to 8 plants from any player.', play: () => [TEMP(3), R('steel', 4), REMOVE_PLANTS(8)] });
add({ name: 'Designed Microorganisms', type: 'automated', cost: 16, tags: ['science', 'microbe'], req: { tempMax: -14 }, text: '+2 plant production.', play: () => [PR('plants', 2)] });
add({ name: 'Domed Crater', type: 'automated', cost: 24, tags: ['city', 'building'], vp: 1, req: { oxyMax: 7 }, text: 'Gain 3 plants. −1 energy, +3 M€ production. Place a city.', play: () => [PR('energy', -1), PR('mc', 3), R('plants', 3), CITY] });
add({ name: 'Dust Seals', type: 'automated', cost: 2, tags: [], vp: 1, req: { oceansMax: 3 }, text: 'No effect beyond VP.' });
add({
  name: 'Ecological Zone', type: 'active', cost: 12, tags: ['animal', 'plant'], resource: 'animal', vp: perRes(2), vpText: '1 VP per 2 animals', req: { greeneries: 1 },
  text: 'Place this tile next to any greenery. Whenever you play an animal or plant tag (this included), add 1 animal here.',
  play: (s, pid, id) => [{ k: 'tile', tile: 'special', rule: 'adjGreenery', card: id }],
  onCard: (s, owner, player, card) => {
    if (owner !== player) return [];
    const n = card.tags.filter((t) => t === 'plant' || t === 'animal').length;
    return n ? [{ k: 'addRes', n, target: 'this' }] : [];
  },
});
add({ name: 'Energy Saving', type: 'automated', cost: 15, tags: ['power'], text: '+1 energy production per city in play.', play: (s) => [PR('energy', cities(s).length)] });
add({ name: 'Eos Chasma National Park', type: 'automated', cost: 16, tags: ['plant', 'building'], vp: 1, req: { temp: -12 }, text: 'Gain 3 plants, add 1 animal to a card. +2 M€ production.', play: () => [PR('mc', 2), R('plants', 3), ADD_OTHER('animal', 1)] });
add({
  name: 'Equatorial Magnetizer', type: 'active', cost: 11, tags: ['building'], text: 'Action: −1 energy production to raise your TR 1 step.',
  action: { text: '−1 energy production: +1 TR', can: (s, pid) => P(s, pid).prod.energy >= 1, run: () => [PR('energy', -1), TR(1)] },
});
add({
  name: 'Extreme-Cold Fungus', type: 'active', cost: 13, tags: ['microbe'], req: { tempMax: -10 }, text: 'Action: gain 1 plant, or add 2 microbes to another card.',
  action: {
    text: 'Gain 1 plant or add 2 microbes to another card', can: () => true,
    run: (s, pid) => [CHOOSE('Extreme-Cold Fungus', [{ label: 'Gain 1 plant', ops: [R('plants', 1)] }, { label: 'Add 2 microbes to another card', ops: [ADD_OTHER('microbe', 2)], ok: hasCardWith(s, pid, 'microbe') }])],
  },
});
add({ name: 'Farming', type: 'automated', cost: 16, tags: ['plant'], vp: 2, req: { temp: 4 }, text: 'Gain 2 plants. +2 M€ and +2 plant production.', play: () => [PR('mc', 2), PR('plants', 2), R('plants', 2)] });
add({
  name: 'Fish', type: 'active', cost: 9, tags: ['animal'], resource: 'animal', vp: perRes(1), vpText: '1 VP per animal', req: { temp: 2 },
  text: 'Decrease any plant production 1 step. Action: add 1 animal here.', canPlay: (s) => anyProd(s, 'plants', 1), play: () => [DEC('plants', 1)],
  action: { text: 'Add 1 animal here', can: () => true, run: () => [ADD_THIS(1)] },
});
add({ name: 'Flooding', type: 'event', cost: 7, tags: [], vp: -1, text: 'Place an ocean. You may take up to 4 M€ from the owner of a tile next to it.', play: (s) => (s.oceans < 9 ? [{ k: 'tile', tile: 'ocean', rule: 'ocean', card: 'flooding' }] : []) });
add({ name: 'Food Factory', type: 'automated', cost: 12, tags: ['building'], vp: 1, text: '−1 plant, +4 M€ production.', play: () => [PR('plants', -1), PR('mc', 4)] });
add({ name: 'Fusion Power', type: 'automated', cost: 14, tags: ['science', 'power', 'building'], req: { tags: { power: 2 } }, text: '+3 energy production.', play: () => [PR('energy', 3)] });
add({ name: 'Fueled Generators', type: 'automated', cost: 1, tags: ['power', 'building'], text: '−1 M€, +1 energy production.', play: () => [PR('mc', -1), PR('energy', 1)] });
add({ name: 'Ganymede Colony', type: 'automated', cost: 20, tags: ['jovian', 'space', 'city'], vp: jovianVP, vpText: '1 VP per Jovian tag', text: 'Place a city on the Ganymede Colony space (off Mars).', play: () => [{ k: 'tile', tile: 'city', rule: 'ganymede' }] });
add({ name: 'Geothermal Power', type: 'automated', cost: 11, tags: ['power', 'building'], text: '+2 energy production.', play: () => [PR('energy', 2)] });
add({ name: 'GHG Factories', type: 'automated', cost: 11, tags: ['building'], text: '−1 energy, +4 heat production.', play: () => [PR('energy', -1), PR('heat', 4)] });
add({
  name: 'GHG Producing Bacteria', type: 'active', cost: 8, tags: ['science', 'microbe'], resource: 'microbe', req: { oxy: 4 },
  text: 'Action: add 1 microbe here, or remove 2 to raise temperature 1 step.',
  action: {
    text: 'Add 1 microbe, or spend 2 to raise temperature', can: () => true,
    run: (s, pid, id) => [CHOOSE('GHG Producing Bacteria', [{ label: 'Add 1 microbe', ops: [ADD_THIS(1)] }, { label: 'Remove 2 microbes: raise temperature', ops: [{ k: 'addRes', n: -2, target: 'this' }, TEMP()], ok: res(s, pid, id) >= 2 }])],
  },
});
add({ name: 'Giant Ice Asteroid', type: 'event', cost: 36, tags: ['space'], text: 'Raise temperature 2 steps and place 2 oceans. Remove up to 6 plants from any player.', play: () => [TEMP(2), OCEAN, OCEAN, REMOVE_PLANTS(6)] });
add({ name: 'Giant Space Mirror', type: 'automated', cost: 17, tags: ['power', 'space'], text: '+3 energy production.', play: () => [PR('energy', 3)] });
add({ name: 'Grass', type: 'automated', cost: 11, tags: ['plant'], req: { temp: -16 }, text: 'Gain 3 plants. +1 plant production.', play: () => [PR('plants', 1), R('plants', 3)] });
add({ name: 'Great Dam', type: 'automated', cost: 12, tags: ['power', 'building'], vp: 1, req: { oceans: 4 }, text: '+2 energy production.', play: () => [PR('energy', 2)] });
add({ name: 'Greenhouses', type: 'automated', cost: 6, tags: ['plant', 'building'], text: 'Gain 1 plant per city in play.', play: (s) => [R('plants', cities(s).length)] });
add({ name: 'Heather', type: 'automated', cost: 6, tags: ['plant'], req: { temp: -14 }, text: 'Gain 1 plant. +1 plant production.', play: () => [PR('plants', 1), R('plants', 1)] });
add({ name: 'Heat Trappers', type: 'automated', cost: 6, tags: ['power', 'building'], vp: -1, text: 'Decrease any heat production 2 steps. +1 energy production.', canPlay: (s) => anyProd(s, 'heat', 2), play: () => [DEC('heat', 2), PR('energy', 1)] });
add({
  name: 'Herbivores', type: 'active', cost: 12, tags: ['animal'], resource: 'animal', vp: perRes(2), vpText: '1 VP per 2 animals', req: { oxy: 8 },
  text: 'Add 1 animal here and decrease any plant production 1 step. Whenever you place a greenery, add 1 animal here.',
  canPlay: (s) => anyProd(s, 'plants', 1), play: () => [ADD_THIS(1), DEC('plants', 1)],
  onTile: (s, owner, placer, sp) => (owner === placer && sp.tile?.kind === 'greenery' ? [ADD_THIS(1)] : []),
});
add({ name: 'Ice Asteroid', type: 'event', cost: 23, tags: ['space'], text: 'Place 2 oceans.', play: () => [OCEAN, OCEAN] });
add({ name: 'Ice Cap Melting', type: 'event', cost: 5, tags: [], req: { temp: 2 }, text: 'Place an ocean.', play: () => [OCEAN] });
add({
  name: 'Immigrant City', type: 'active', cost: 13, tags: ['city', 'building'], text: '−1 energy, −2 M€ production. Place a city. Whenever any city is placed (this included), +1 M€ production.',
  play: () => [PR('energy', -1), PR('mc', -2), CITY], onTile: (s, owner, placer, sp) => (sp.tile?.kind === 'city' ? [PR('mc', 1)] : []),
});
add({ name: 'Immigration Shuttles', type: 'automated', cost: 31, tags: ['earth', 'space'], vp: (s) => Math.floor(cities(s).length / 3), vpText: '1 VP per 3 cities in play', text: '+5 M€ production.', play: () => [PR('mc', 5)] });
add({ name: 'Imported GHG', type: 'event', cost: 7, tags: ['earth', 'space'], text: 'Gain 3 heat. +1 heat production.', play: () => [PR('heat', 1), R('heat', 3)] });
add({
  name: 'Imported Hydrogen', type: 'event', cost: 16, tags: ['earth', 'space'], text: 'Gain 3 plants, or add 3 microbes or 2 animals to another card. Place an ocean.',
  play: (s, pid) => [CHOOSE('Imported Hydrogen', [{ label: 'Gain 3 plants', ops: [R('plants', 3)] }, { label: 'Add 3 microbes to a card', ops: [ADD_OTHER('microbe', 3)], ok: hasCardWith(s, pid, 'microbe') }, { label: 'Add 2 animals to a card', ops: [ADD_OTHER('animal', 2)], ok: hasCardWith(s, pid, 'animal') }]), OCEAN],
});
add({ name: 'Imported Nitrogen', type: 'event', cost: 23, tags: ['earth', 'space'], text: '+1 TR. Gain 4 plants. Add 3 microbes and 2 animals to other cards.', play: () => [TR(1), R('plants', 4), ADD_OTHER('microbe', 3), ADD_OTHER('animal', 2)] });
add({ name: 'Import of Advanced GHG', type: 'event', cost: 9, tags: ['earth', 'space'], text: '+2 heat production.', play: () => [PR('heat', 2)] });
add({ name: 'Industrial Microbes', type: 'automated', cost: 12, tags: ['microbe', 'building'], text: '+1 energy and +1 steel production.', play: () => [PR('energy', 1), PR('steel', 1)] });
add({ name: 'Insects', type: 'automated', cost: 9, tags: ['microbe'], req: { oxy: 6 }, text: '+1 plant production per plant tag you have.', play: (s, pid) => [PR('plants', tagCount(s, pid, 'plant'))] });
add({ name: 'Insulation', type: 'automated', cost: 2, tags: [], text: 'Convert any number of heat production steps into M€ production.', canPlay: (s, pid) => P(s, pid).prod.heat > 0, play: (s, pid) => [{ k: 'amount', id: 'insulation', title: 'Move how much heat production to M€?', max: P(s, pid).prod.heat }] });
add({
  name: 'Ironworks', type: 'active', cost: 11, tags: ['building'], text: 'Action: spend 4 energy to gain 1 steel and raise oxygen 1 step.',
  action: { text: 'Spend 4 energy: 1 steel, raise oxygen', can: (s, pid) => P(s, pid).res.energy >= 4, run: () => [R('energy', -4), R('steel', 1), OXY()] },
});
add({ name: 'Kelp Farming', type: 'automated', cost: 17, tags: ['plant'], vp: 1, req: { oceans: 6 }, text: 'Gain 2 plants. +2 M€ and +3 plant production.', play: () => [PR('mc', 2), PR('plants', 3), R('plants', 2)] });
add({ name: 'Lake Marineris', type: 'automated', cost: 18, tags: [], vp: 2, req: { temp: 0 }, text: 'Place 2 oceans.', play: () => [OCEAN, OCEAN] });
add({
  name: 'Large Convoy', type: 'event', cost: 36, tags: ['earth', 'space'], vp: 2, text: 'Place an ocean, draw 2 cards, and gain 5 plants or add 4 animals to a card.',
  play: (s, pid) => [OCEAN, DRAW(2), CHOOSE('Large Convoy', [{ label: 'Gain 5 plants', ops: [R('plants', 5)] }, { label: 'Add 4 animals to a card', ops: [ADD_OTHER('animal', 4)], ok: hasCardWith(s, pid, 'animal') }])],
});
add({ name: 'Lava Flows', type: 'event', cost: 18, tags: [], text: 'Raise temperature 2 steps. Place this tile on one of the four volcanoes.', play: (s, pid, id) => [TEMP(2), { k: 'tile', tile: 'special', rule: 'volcanic', card: id }] });
add({ name: 'Lichen', type: 'automated', cost: 7, tags: ['plant'], req: { temp: -24 }, text: '+1 plant production.', play: () => [PR('plants', 1)] });
add({
  name: 'Livestock', type: 'active', cost: 13, tags: ['animal'], resource: 'animal', vp: perRes(1), vpText: '1 VP per animal', req: { oxy: 9 },
  text: '−1 plant, +2 M€ production. Action: add 1 animal here.', play: () => [PR('plants', -1), PR('mc', 2)],
  action: { text: 'Add 1 animal here', can: () => true, run: () => [ADD_THIS(1)] },
});
add({
  name: 'Local Heat Trapping', type: 'event', cost: 1, tags: [], text: 'Spend 5 heat to gain 4 plants or add 2 animals to a card.',
  canPlay: (s, pid) => P(s, pid).res.heat >= 5,
  play: (s, pid) => [R('heat', -5), CHOOSE('Local Heat Trapping', [{ label: 'Gain 4 plants', ops: [R('plants', 4)] }, { label: 'Add 2 animals to a card', ops: [ADD_OTHER('animal', 2)], ok: hasCardWith(s, pid, 'animal') }])],
});
add({ name: 'Lunar Beam', type: 'automated', cost: 13, tags: ['earth', 'power'], text: '−2 M€, +2 heat and +2 energy production.', play: () => [PR('mc', -2), PR('heat', 2), PR('energy', 2)] });
add({ name: 'Magnetic Field Dome', type: 'automated', cost: 5, tags: ['building'], text: '−2 energy, +1 plant production. +1 TR.', play: () => [PR('energy', -2), PR('plants', 1), TR(1)] });
add({ name: 'Magnetic Field Generators', type: 'automated', cost: 20, tags: ['building'], text: '−4 energy, +2 plant production. +3 TR.', play: () => [PR('energy', -4), PR('plants', 2), TR(3)] });
add({ name: 'Mangrove', type: 'automated', cost: 12, tags: ['plant'], vp: 1, req: { temp: 4 }, text: 'Place a greenery on an ocean area.', play: () => [{ k: 'tile', tile: 'greenery', rule: 'oceanArea' }] });
add({
  name: 'Martian Rails', type: 'active', cost: 13, tags: ['building'], text: 'Action: spend 1 energy to gain 1 M€ per city on Mars.',
  action: { text: 'Spend 1 energy: 1 M€ per city on Mars', can: (s, pid) => P(s, pid).res.energy >= 1, run: (s) => [R('energy', -1), R('mc', cities(s, { marsOnly: true }).length)] },
});
add({ name: 'Methane From Titan', type: 'automated', cost: 28, tags: ['jovian', 'space'], vp: 2, req: { oxy: 2 }, text: '+2 heat and +2 plant production.', play: () => [PR('heat', 2), PR('plants', 2)] });
add({ name: 'Micro-Mills', type: 'automated', cost: 3, tags: [], text: '+1 heat production.', play: () => [PR('heat', 1)] });
add({ name: 'Mining Expedition', type: 'event', cost: 12, tags: [], text: 'Raise oxygen 1 step. Gain 2 steel. Remove up to 2 plants from any player.', play: () => [OXY(), R('steel', 2), REMOVE_PLANTS(2)] });
add({ name: 'Mining Rights', type: 'automated', cost: 9, tags: ['building'], text: 'Place this tile on a space with a steel or titanium bonus; +1 production of that resource.', play: (s, pid, id) => [{ k: 'tile', tile: 'special', rule: 'miningRights', card: id }] });
add({ name: 'Mohole Area', type: 'automated', cost: 20, tags: ['building'], text: '+4 heat production. Place this tile on an ocean area.', play: (s, pid, id) => [PR('heat', 4), { k: 'tile', tile: 'special', rule: 'oceanArea', card: id }] });
add({ name: 'Moss', type: 'automated', cost: 4, tags: ['plant'], req: { oceans: 3 }, text: 'Lose 1 plant. +1 plant production.', play: () => [R('plants', -1), PR('plants', 1)] });
add({ name: 'Natural Preserve', type: 'automated', cost: 9, tags: ['science', 'building'], vp: 1, req: { oxyMax: 4 }, text: '+1 M€ production. Place this tile away from all other tiles.', play: (s, pid, id) => [PR('mc', 1), { k: 'tile', tile: 'special', rule: 'isolated', card: id }] });
add({
  name: 'Nitrite Reducing Bacteria', type: 'active', cost: 11, tags: ['microbe'], resource: 'microbe', text: 'Add 3 microbes here. Action: add 1 microbe, or remove 3 to raise TR 1 step.',
  play: () => [ADD_THIS(3)],
  action: {
    text: 'Add 1 microbe, or spend 3 for +1 TR', can: () => true,
    run: (s, pid, id) => [CHOOSE('Nitrite Reducing Bacteria', [{ label: 'Add 1 microbe', ops: [ADD_THIS(1)] }, { label: 'Remove 3 microbes: +1 TR', ops: [{ k: 'addRes', n: -3, target: 'this' }, TR(1)], ok: res(s, pid, id) >= 3 }])],
  },
});
add({ name: 'Nitrogen-Rich Asteroid', type: 'event', cost: 31, tags: ['space'], text: '+2 TR, raise temperature 1 step. +1 plant production, or +4 if you have 3 plant tags.', play: (s, pid) => [TR(2), TEMP(), PR('plants', tagCount(s, pid, 'plant') >= 3 ? 4 : 1)] });
add({ name: 'Nitrophilic Moss', type: 'automated', cost: 8, tags: ['plant'], req: { oceans: 3 }, text: 'Lose 2 plants. +2 plant production.', play: () => [R('plants', -2), PR('plants', 2)] });
add({ name: 'Noctis City', type: 'automated', cost: 18, tags: ['city', 'building'], text: '−1 energy, +3 M€ production. Place a city on the reserved Noctis City space.', play: () => [PR('energy', -1), PR('mc', 3), { k: 'tile', tile: 'city', rule: 'noctis' }] });
add({ name: 'Noctis Farming', type: 'automated', cost: 10, tags: ['plant', 'building'], vp: 1, req: { temp: -20 }, text: 'Gain 2 plants. +1 M€ production.', play: () => [PR('mc', 1), R('plants', 2)] });
add({ name: 'Nuclear Power', type: 'automated', cost: 10, tags: ['power', 'building'], text: '−2 M€, +3 energy production.', play: () => [PR('mc', -2), PR('energy', 3)] });
add({ name: 'Nuclear Zone', type: 'automated', cost: 10, tags: ['earth'], vp: -2, text: 'Place this tile on land. Raise temperature 2 steps.', play: (s, pid, id) => [{ k: 'tile', tile: 'special', rule: 'land', card: id }, TEMP(2)] });
add({ name: 'Open City', type: 'automated', cost: 23, tags: ['city', 'building'], vp: 1, req: { oxy: 12 }, text: 'Gain 2 plants. −1 energy, +4 M€ production. Place a city.', play: () => [PR('energy', -1), PR('mc', 4), R('plants', 2), CITY] });
add({
  name: 'Optimal Aerobraking', type: 'active', cost: 7, tags: ['space'], text: 'Whenever you play a space event, gain 3 M€ and 3 heat.',
  onCard: (s, owner, player, card) => (owner === player && card.type === 'event' && card.tags.includes('space') ? [R('mc', 3), R('heat', 3)] : []),
});
add({
  name: 'Ore Processor', type: 'active', cost: 13, tags: ['building'], text: 'Action: spend 4 energy to gain 1 titanium and raise oxygen 1 step.',
  action: { text: 'Spend 4 energy: 1 titanium, raise oxygen', can: (s, pid) => P(s, pid).res.energy >= 4, run: () => [R('energy', -4), R('titanium', 1), OXY()] },
});
add({ name: 'Permafrost Extraction', type: 'event', cost: 8, tags: [], req: { temp: -8 }, text: 'Place an ocean.', play: () => [OCEAN] });
add({ name: 'Peroxide Power', type: 'automated', cost: 7, tags: ['power', 'building'], text: '−1 M€, +2 energy production.', play: () => [PR('mc', -1), PR('energy', 2)] });
add({
  name: 'Pets', type: 'active', cost: 10, tags: ['earth', 'animal'], resource: 'animal', protectedRes: true, vp: perRes(2), vpText: '1 VP per 2 animals',
  text: 'Add 1 animal here. Whenever any city is placed, add 1 animal here. Animals here cannot be removed.',
  play: () => [ADD_THIS(1)], onTile: (s, owner, placer, sp) => (sp.tile?.kind === 'city' ? [ADD_THIS(1)] : []),
});
add({ name: 'Phobos Space Haven', type: 'automated', cost: 25, tags: ['space', 'city'], vp: 3, text: '+1 titanium production. Place a city on the Phobos space (off Mars).', play: () => [PR('titanium', 1), { k: 'tile', tile: 'city', rule: 'phobos' }] });
add({ name: 'Plantation', type: 'automated', cost: 15, tags: ['plant'], req: { tags: { science: 2 } }, text: 'Place a greenery.', play: () => [GREEN] });
add({ name: 'Power Grid', type: 'automated', cost: 18, tags: ['power'], text: '+1 energy production per power tag you have (this included).', play: (s, pid) => [PR('energy', tagCount(s, pid, 'power'))] });
add({ name: 'Power Plant', type: 'automated', cost: 4, tags: ['power', 'building'], text: '+1 energy production.', play: () => [PR('energy', 1)] });
add({
  name: 'Predators', type: 'active', cost: 14, tags: ['animal'], resource: 'animal', vp: perRes(1), vpText: '1 VP per animal', req: { oxy: 11 },
  text: 'Action: take 1 animal from any card and add it here.',
  action: {
    text: 'Move 1 animal from any card to this card',
    can: (s, pid, id) => s.players.some((p) => p.played.some((c) => c !== id && CARDS[c].resource === 'animal' && !CARDS[c].protectedRes && (p.cardRes[c] ?? 0) > 0 && (p.id === pid || !protects(s, p.id, 'animal')))),
    run: (s, pid, id) => [{ k: 'removeCardRes', n: 1, rtype: 'animal', gainTo: id }],
  },
});
add({ name: 'Protected Valley', type: 'automated', cost: 23, tags: ['plant', 'building'], text: '+2 M€ production. Place a greenery on an ocean area.', play: () => [PR('mc', 2), { k: 'tile', tile: 'greenery', rule: 'oceanArea' }] });
add({ name: 'Rad-Chem Factory', type: 'automated', cost: 8, tags: ['building'], text: '−1 energy production. +2 TR.', play: () => [PR('energy', -1), TR(2)] });
add({
  name: 'Regolith Eaters', type: 'active', cost: 13, tags: ['science', 'microbe'], resource: 'microbe', text: 'Action: add 1 microbe here, or remove 2 to raise oxygen 1 step.',
  action: {
    text: 'Add 1 microbe, or spend 2 to raise oxygen', can: () => true,
    run: (s, pid, id) => [CHOOSE('Regolith Eaters', [{ label: 'Add 1 microbe', ops: [ADD_THIS(1)] }, { label: 'Remove 2 microbes: raise oxygen', ops: [{ k: 'addRes', n: -2, target: 'this' }, OXY()], ok: res(s, pid, id) >= 2 }])],
  },
});
add({ name: 'Release of Inert Gases', type: 'event', cost: 14, tags: [], text: '+2 TR.', play: () => [TR(2)] });
add({ name: 'Research Outpost', type: 'active', cost: 18, tags: ['science', 'city', 'building'], discount: { n: 1 }, text: 'Cards cost you 1 M€ less. Place a city away from all other tiles.', play: () => [{ k: 'tile', tile: 'city', rule: 'cityIsolated' }] });
add({ name: 'Rover Construction', type: 'active', cost: 8, tags: ['building'], vp: 1, text: 'Whenever any city is placed, gain 2 M€.', onTile: (s, owner, placer, sp) => (sp.tile?.kind === 'city' ? [R('mc', 2)] : []) });
add({
  name: 'Search For Life', type: 'active', cost: 3, tags: ['science'], resource: 'science', req: { oxyMax: 6 }, vp: (s, pid, id) => (res(s, pid, id) > 0 ? 3 : 0), vpText: '3 VP if it has any science resource',
  text: 'Action: pay 1 M€ to reveal the top card. If it has a microbe tag, add a science resource here.',
  action: { text: 'Pay 1 M€: reveal the top card', mc: 1, can: () => true, run: (s, pid, id) => [{ k: 'searchLife', card: id }] },
});
add({ name: 'Shuttles', type: 'active', cost: 10, tags: ['space'], vp: 1, req: { oxy: 5 }, discount: { tag: 'space', n: 2 }, text: '−1 energy, +2 M€ production. Space cards cost you 2 M€ less.', play: () => [PR('energy', -1), PR('mc', 2)] });
add({
  name: 'Small Animals', type: 'active', cost: 6, tags: ['animal'], resource: 'animal', vp: perRes(2), vpText: '1 VP per 2 animals', req: { oxy: 6 },
  text: 'Decrease any plant production 1 step. Action: add 1 animal here.', canPlay: (s) => anyProd(s, 'plants', 1), play: () => [DEC('plants', 1)],
  action: { text: 'Add 1 animal here', can: () => true, run: () => [ADD_THIS(1)] },
});
add({ name: 'Soil Factory', type: 'automated', cost: 9, tags: ['building'], vp: 1, text: '−1 energy, +1 plant production.', play: () => [PR('energy', -1), PR('plants', 1)] });
add({ name: 'Solar Power', type: 'automated', cost: 11, tags: ['power', 'building'], vp: 1, text: '+1 energy production.', play: () => [PR('energy', 1)] });
add({ name: 'Solar Wind Power', type: 'automated', cost: 11, tags: ['science', 'space', 'power'], text: 'Gain 2 titanium. +1 energy production.', play: () => [PR('energy', 1), R('titanium', 2)] });
add({ name: 'Soletta', type: 'automated', cost: 35, tags: ['space'], text: '+7 heat production.', play: () => [PR('heat', 7)] });
add({
  name: 'Space Mirrors', type: 'active', cost: 3, tags: ['power', 'space'], text: 'Action: pay 7 M€ for +1 energy production.',
  action: { text: 'Pay 7 M€: +1 energy production', mc: 7, can: () => true, run: () => [PR('energy', 1)] },
});
add({ name: 'Special Design', type: 'event', cost: 4, tags: ['science'], text: 'The next card you play this generation has ±2 steps on its global requirement.' });
add({
  name: 'Steelworks', type: 'active', cost: 15, tags: ['building'], text: 'Action: spend 4 energy to gain 2 steel and raise oxygen 1 step.',
  action: { text: 'Spend 4 energy: 2 steel, raise oxygen', can: (s, pid) => P(s, pid).res.energy >= 4, run: () => [R('energy', -4), R('steel', 2), OXY()] },
});
add({ name: 'Strip Mine', type: 'automated', cost: 25, tags: ['building'], text: '−2 energy, +2 steel, +1 titanium production. Raise oxygen 2 steps.', play: () => [PR('energy', -2), PR('steel', 2), PR('titanium', 1), OXY(2)] });
add({ name: 'Subterranean Reservoir', type: 'event', cost: 11, tags: [], text: 'Place an ocean.', play: () => [OCEAN] });
add({
  name: 'Symbiotic Fungus', type: 'active', cost: 4, tags: ['microbe'], req: { temp: -14 }, text: 'Action: add 1 microbe to another card.',
  action: { text: 'Add 1 microbe to another card', can: (s, pid) => hasCardWith(s, pid, 'microbe'), run: () => [ADD_OTHER('microbe', 1)] },
});
add({ name: 'Tectonic Stress Power', type: 'automated', cost: 18, tags: ['power', 'building'], vp: 1, req: { tags: { science: 2 } }, text: '+3 energy production.', play: () => [PR('energy', 3)] });
add({ name: 'Towing A Comet', type: 'event', cost: 23, tags: ['space'], text: 'Gain 2 plants. Raise oxygen 1 step and place an ocean.', play: () => [R('plants', 2), OXY(), OCEAN] });
add({ name: 'Trees', type: 'automated', cost: 13, tags: ['plant'], vp: 1, req: { temp: -4 }, text: 'Gain 1 plant. +3 plant production.', play: () => [PR('plants', 3), R('plants', 1)] });
add({ name: 'Tundra Farming', type: 'automated', cost: 16, tags: ['plant'], vp: 2, req: { temp: -6 }, text: 'Gain 1 plant. +1 plant and +2 M€ production.', play: () => [PR('plants', 1), PR('mc', 2), R('plants', 1)] });
add({ name: 'Underground City', type: 'automated', cost: 18, tags: ['city', 'building'], text: '−2 energy, +2 steel production. Place a city.', play: () => [PR('energy', -2), PR('steel', 2), CITY] });
add({
  name: 'Underground Detonations', type: 'active', cost: 6, tags: ['building'], text: 'Action: pay 10 M€ for +2 heat production.',
  action: { text: 'Pay 10 M€: +2 heat production', mc: 10, can: () => true, run: () => [PR('heat', 2)] },
});
add({ name: 'Urbanized Area', type: 'automated', cost: 10, tags: ['city', 'building'], text: '−1 energy, +2 M€ production. Place a city next to at least 2 other cities.', play: () => [PR('energy', -1), PR('mc', 2), { k: 'tile', tile: 'city', rule: 'adj2Cities' }] });
add({
  name: 'Water Import From Europa', type: 'active', cost: 25, tags: ['jovian', 'space'], vp: jovianVP, vpText: '1 VP per Jovian tag', text: 'Action: pay 12 M€ (titanium may be used) to place an ocean.',
  action: { text: 'Pay 12 M€: place an ocean', mc: 12, titanium: true, can: () => true, run: () => [OCEAN] },
});
add({
  name: 'Water Splitting Plant', type: 'active', cost: 12, tags: ['building'], req: { oceans: 2 }, text: 'Action: spend 3 energy to raise oxygen 1 step.',
  action: { text: 'Spend 3 energy: raise oxygen', can: (s, pid) => P(s, pid).res.energy >= 3, run: () => [R('energy', -3), OXY()] },
});
add({ name: 'Wave Power', type: 'automated', cost: 8, tags: ['power'], vp: 1, req: { oceans: 3 }, text: '+1 energy production.', play: () => [PR('energy', 1)] });
add({ name: 'Windmills', type: 'automated', cost: 6, tags: ['power', 'building'], vp: 1, req: { oxy: 7 }, text: '+1 energy production.', play: () => [PR('energy', 1)] });
add({ name: 'Worms', type: 'automated', cost: 8, tags: ['microbe'], req: { oxy: 4 }, text: '+1 plant production per 2 microbe tags you have (this included).', play: (s, pid) => [PR('plants', Math.floor(tagCount(s, pid, 'microbe') / 2))] });
add({ name: 'Zeppelins', type: 'automated', cost: 13, tags: [], vp: 1, req: { oxy: 5 }, text: '+1 M€ production per city on Mars.', play: (s) => [PR('mc', cities(s, { marsOnly: true }).length)] });

// ================= Corporate Era projects =================
addCE({ name: 'Acquired Company', type: 'automated', cost: 10, tags: ['earth'], text: '+3 M€ production.', play: () => [PR('mc', 3)] });
addCE({ name: 'Advanced Alloys', type: 'active', cost: 9, tags: ['science'], text: 'Your steel and titanium are each worth 1 M€ extra.' });
addCE({
  name: 'AI Central', type: 'active', cost: 21, tags: ['science', 'building'], vp: 1, req: { tags: { science: 3 } }, text: '−1 energy production. Action: draw 2 cards.',
  play: () => [PR('energy', -1)], action: { text: 'Draw 2 cards', can: () => true, run: () => [DRAW(2)] },
});
addCE({ name: 'Anti-Gravity Technology', type: 'active', cost: 14, tags: ['science'], vp: 3, req: { tags: { science: 7 } }, discount: { n: 2 }, text: 'Cards cost you 2 M€ less.' });
addCE({ name: 'Asteroid Mining Consortium', type: 'automated', cost: 13, tags: ['jovian'], vp: 1, req: { prod: { titanium: 1 } }, text: 'Decrease any titanium production 1 step and increase yours 1 step.', canPlay: (s) => anyProd(s, 'titanium', 1), play: () => [DEC('titanium', 1, true)] });
addCE({ name: 'Bribed Committee', type: 'event', cost: 7, tags: ['earth'], vp: -2, text: '+2 TR.', play: () => [TR(2)] });
addCE({ name: 'Building Industries', type: 'automated', cost: 6, tags: ['building'], text: '−1 energy, +2 steel production.', play: () => [PR('energy', -1), PR('steel', 2)] });
addCE({ name: 'Business Contacts', type: 'event', cost: 7, tags: ['earth'], text: 'Look at the top 4 cards; keep 2, discard the rest.', play: () => [{ k: 'look', n: 4, keep: 2, buy: false }] });
addCE({
  name: 'Business Network', type: 'active', cost: 4, tags: ['earth'], text: '−1 M€ production. Action: look at the top card and buy it for 3 M€ or discard it.',
  play: () => [PR('mc', -1)], action: { text: 'Look at the top card (buy for 3 M€)', can: () => true, run: () => [{ k: 'look', n: 1, keep: 1, buy: true }] },
});
addCE({ name: 'Callisto Penal Mines', type: 'automated', cost: 24, tags: ['jovian', 'space'], vp: 2, text: '+3 M€ production.', play: () => [PR('mc', 3)] });
addCE({
  name: 'Caretaker Contract', type: 'active', cost: 3, tags: [], req: { temp: 0 }, text: 'Action: spend 8 heat to raise your TR 1 step.',
  action: { text: 'Spend 8 heat: +1 TR', can: (s, pid) => P(s, pid).res.heat >= 8, run: () => [R('heat', -8), TR(1)] },
});
addCE({ name: 'Cartel', type: 'automated', cost: 8, tags: ['earth'], text: '+1 M€ production per Earth tag you have (this included).', play: (s, pid) => [PR('mc', tagCount(s, pid, 'earth'))] });
addCE({
  name: "CEO's Favorite Project", type: 'event', cost: 1, tags: [], text: 'Add 1 resource to a card that already has resources.',
  canPlay: (s, pid) => P(s, pid).played.some((c) => (P(s, pid).cardRes[c] ?? 0) > 0), play: () => [{ k: 'addRes', n: 1, target: 'anyWithRes' }],
});
addCE({
  name: 'Commercial District', type: 'automated', cost: 16, tags: ['building'],
  vp: (s, pid, id) => { const sp = cardSpace(s, id); return sp ? adjacentCount(s, sp.id, (x) => x.tile?.kind === 'city') : 0; }, vpText: '1 VP per adjacent city',
  text: '−1 energy, +4 M€ production. Place this tile on land.', play: (s, pid, id) => [PR('energy', -1), PR('mc', 4), { k: 'tile', tile: 'special', rule: 'land', card: id }],
});
addCE({ name: 'Corporate Stronghold', type: 'automated', cost: 11, tags: ['city', 'building'], vp: -2, text: '−1 energy, +3 M€ production. Place a city.', play: () => [PR('energy', -1), PR('mc', 3), CITY] });
addCE({
  name: 'Development Center', type: 'active', cost: 11, tags: ['science', 'building'], text: 'Action: spend 1 energy to draw a card.',
  action: { text: 'Spend 1 energy: draw a card', can: (s, pid) => P(s, pid).res.energy >= 1, run: () => [R('energy', -1), DRAW(1)] },
});
addCE({ name: 'Earth Catapult', type: 'active', cost: 23, tags: ['earth'], vp: 2, discount: { n: 2 }, text: 'Cards cost you 2 M€ less.' });
addCE({ name: 'Earth Office', type: 'active', cost: 1, tags: ['earth'], discount: { tag: 'earth', n: 3 }, text: 'Earth cards cost you 3 M€ less.' });
addCE({
  name: 'Electro Catapult', type: 'active', cost: 17, tags: ['building'], vp: 1, req: { oxyMax: 8 }, text: '−1 energy production. Action: spend 1 plant or 1 steel to gain 7 M€.',
  play: () => [PR('energy', -1)],
  action: {
    text: 'Spend 1 plant or 1 steel: gain 7 M€', can: (s, pid) => P(s, pid).res.plants > 0 || P(s, pid).res.steel > 0,
    run: (s, pid) => [CHOOSE('Electro Catapult', [{ label: 'Spend 1 plant', ops: [R('plants', -1), R('mc', 7)], ok: P(s, pid).res.plants > 0 }, { label: 'Spend 1 steel', ops: [R('steel', -1), R('mc', 7)], ok: P(s, pid).res.steel > 0 }])],
  },
});
addCE({ name: 'Energy Tapping', type: 'automated', cost: 3, tags: ['power'], vp: -1, text: 'Decrease any energy production 1 step and increase yours 1 step.', canPlay: (s) => anyProd(s, 'energy', 1), play: () => [DEC('energy', 1, true)] });
addCE({ name: 'Fuel Factory', type: 'automated', cost: 6, tags: ['building'], text: '−1 energy, +1 titanium and +1 M€ production.', play: () => [PR('energy', -1), PR('titanium', 1), PR('mc', 1)] });
addCE({ name: 'Gene Repair', type: 'automated', cost: 12, tags: ['science'], vp: 2, req: { tags: { science: 3 } }, text: '+2 M€ production.', play: () => [PR('mc', 2)] });
addCE({ name: 'Great Escarpment Consortium', type: 'automated', cost: 6, tags: [], req: { prod: { steel: 1 } }, text: 'Decrease any steel production 1 step and increase yours 1 step.', canPlay: (s) => anyProd(s, 'steel', 1), play: () => [DEC('steel', 1, true)] });
addCE({ name: 'Hackers', type: 'automated', cost: 3, tags: [], vp: -1, canPlay: (s) => anyProd(s, 'mc', 2), text: '−1 energy production. Decrease any M€ production 2 steps and increase yours 2 steps.', play: () => [PR('energy', -1), DEC('mc', 2, true)] });
addCE({
  name: 'Hired Raiders', type: 'event', cost: 1, tags: [], text: 'Steal up to 2 steel or up to 3 M€ from any player.',
  play: () => [CHOOSE('Hired Raiders', [{ label: 'Steal up to 2 steel', ops: [{ k: 'steal', r: 'steel', n: 2 }] }, { label: 'Steal up to 3 M€', ops: [{ k: 'steal', r: 'mc', n: 3 }] }])],
});
addCE({ name: 'Indentured Workers', type: 'event', cost: 0, tags: [], vp: -1, text: 'The next card you play this generation costs 8 M€ less.' });
addCE({
  name: 'Industrial Center', type: 'active', cost: 4, tags: ['building'], text: 'Place this tile next to a city. Action: pay 7 M€ for +1 steel production.',
  play: (s, pid, id) => [{ k: 'tile', tile: 'special', rule: 'adjCity', card: id }],
  action: { text: 'Pay 7 M€: +1 steel production', mc: 7, can: () => true, run: () => [PR('steel', 1)] },
});
addCE({ name: 'Interstellar Colony Ship', type: 'event', cost: 24, tags: ['earth', 'space'], vp: 4, req: { tags: { science: 5 } }, text: 'No effect beyond VP.' });
addCE({ name: 'Invention Contest', type: 'event', cost: 2, tags: ['science'], text: 'Look at the top 3 cards; keep 1, discard the rest.', play: () => [{ k: 'look', n: 3, keep: 1, buy: false }] });
addCE({ name: "Inventors' Guild", type: 'active', cost: 9, tags: ['science'], text: 'Action: look at the top card and buy it for 3 M€ or discard it.', action: { text: 'Look at the top card (buy for 3 M€)', can: () => true, run: () => [{ k: 'look', n: 1, keep: 1, buy: true }] } });
addCE({ name: 'Investment Loan', type: 'event', cost: 3, tags: ['earth'], text: '−1 M€ production. Gain 10 M€.', play: () => [PR('mc', -1), R('mc', 10)] });
addCE({ name: 'Io Mining Industries', type: 'automated', cost: 41, tags: ['jovian', 'space'], vp: jovianVP, vpText: '1 VP per Jovian tag', text: '+2 titanium and +2 M€ production.', play: () => [PR('titanium', 2), PR('mc', 2)] });
addCE({ name: 'Lagrange Observatory', type: 'automated', cost: 9, tags: ['science', 'space'], vp: 1, text: 'Draw 1 card.', play: () => [DRAW(1)] });
addCE({ name: 'Land Claim', type: 'event', cost: 1, tags: [], text: 'Reserve an empty space; only you may place a tile there.', play: () => [{ k: 'tile', tile: 'special', rule: 'claim' }] });
addCE({ name: 'Lightning Harvest', type: 'automated', cost: 8, tags: ['power'], vp: 1, req: { tags: { science: 3 } }, text: '+1 energy and +1 M€ production.', play: () => [PR('energy', 1), PR('mc', 1)] });
addCE({
  name: 'Mars University', type: 'active', cost: 8, tags: ['science', 'building'], vp: 1, text: 'Whenever you play a science tag (this included), you may discard a card to draw a card.',
  onCard: (s, owner, player, card) => (owner === player ? card.tags.filter((t) => t === 'science').map((): Op => ({ k: 'discardDraw' })) : []),
});
addCE({ name: 'Mass Converter', type: 'active', cost: 8, tags: ['science', 'power'], req: { tags: { science: 5 } }, discount: { tag: 'space', n: 2 }, text: '+6 energy production. Space cards cost you 2 M€ less.', play: () => [PR('energy', 6)] });
addCE({ name: 'Media Archives', type: 'automated', cost: 8, tags: ['earth'], text: 'Gain 1 M€ per event played by any player.', play: (s) => [R('mc', s.players.reduce((a, p) => a + eventsPlayed(s, p.id), 0))] });
addCE({ name: 'Media Group', type: 'active', cost: 6, tags: ['earth'], text: 'Whenever you play an event, gain 3 M€.', onCard: (s, owner, player, card) => (owner === player && card.type === 'event' ? [R('mc', 3)] : []) });
addCE({ name: 'Medical Lab', type: 'automated', cost: 13, tags: ['science', 'building'], vp: 1, text: '+1 M€ production per 2 building tags you have (this included).', play: (s, pid) => [PR('mc', Math.floor(tagCount(s, pid, 'building') / 2))] });
addCE({ name: 'Mine', type: 'automated', cost: 4, tags: ['building'], text: '+1 steel production.', play: () => [PR('steel', 1)] });
addCE({ name: 'Mineral Deposit', type: 'event', cost: 5, tags: [], text: 'Gain 5 steel.', play: () => [R('steel', 5)] });
addCE({ name: 'Mining Area', type: 'automated', cost: 4, tags: ['building'], text: 'Place this tile next to one of yours, on a steel or titanium bonus; +1 production of that resource.', play: (s, pid, id) => [{ k: 'tile', tile: 'special', rule: 'miningArea', card: id }] });
addCE({ name: 'Miranda Resort', type: 'automated', cost: 12, tags: ['jovian', 'space'], vp: 1, text: '+1 M€ production per Earth tag you have.', play: (s, pid) => [PR('mc', tagCount(s, pid, 'earth'))] });
addCE({
  name: 'Olympus Conference', type: 'active', cost: 10, tags: ['science', 'earth', 'building'], resource: 'science', vp: 1,
  text: 'Whenever you play a science tag (this included), add a science resource here, or remove one to draw a card.',
  onCard: (s, owner, player, card) => {
    if (owner !== player) return [];
    const id = 'olympus-conference';
    return card.tags.filter((t) => t === 'science').map((): Op => CHOOSE('Olympus Conference', [
      { label: 'Add a science resource', ops: [{ k: 'addRes', n: 1, target: 'this', card: id }] },
      { label: 'Remove a science resource: draw a card', ops: [{ k: 'addRes', n: -1, target: 'this', card: id }, DRAW(1)], ok: res(s, owner, id) > 0 },
    ]));
  },
});
addCE({
  name: 'Physics Complex', type: 'active', cost: 12, tags: ['science', 'building'], resource: 'science', vp: (s, pid, id) => 2 * res(s, pid, id), vpText: '2 VP per science resource',
  text: 'Action: spend 6 energy to add a science resource here.',
  action: { text: 'Spend 6 energy: add a science resource', can: (s, pid) => P(s, pid).res.energy >= 6, run: () => [R('energy', -6), ADD_THIS(1)] },
});
addCE({
  name: 'Power Infrastructure', type: 'active', cost: 4, tags: ['power', 'building'], text: 'Action: spend any amount of energy to gain that many M€.',
  action: { text: 'Convert energy to M€', can: (s, pid) => P(s, pid).res.energy > 0, run: (s, pid) => [{ k: 'amount', id: 'powerInfra', title: 'Convert how much energy to M€?', max: P(s, pid).res.energy }] },
});
addCE({ name: 'Power Supply Consortium', type: 'automated', cost: 5, tags: ['power'], req: { tags: { power: 2 } }, text: 'Decrease any energy production 1 step and increase yours 1 step.', canPlay: (s) => anyProd(s, 'energy', 1), play: () => [DEC('energy', 1, true)] });
addCE({ name: 'Protected Habitats', type: 'active', cost: 5, tags: [], text: 'Opponents cannot remove your plants, animals or microbes.' });
addCE({ name: 'Quantum Extractor', type: 'active', cost: 13, tags: ['science', 'power'], req: { tags: { science: 4 } }, discount: { tag: 'space', n: 2 }, text: '+4 energy production. Space cards cost you 2 M€ less.', play: () => [PR('energy', 4)] });
addCE({ name: 'Rad-Suits', type: 'automated', cost: 6, tags: [], vp: 1, req: { citiesAll: 2 }, text: '+1 M€ production.', play: () => [PR('mc', 1)] });
addCE({ name: 'Research', type: 'automated', cost: 11, tags: ['science', 'science'], vp: 1, text: 'Draw 2 cards.', play: () => [DRAW(2)] });
addCE({
  name: 'Restricted Area', type: 'active', cost: 11, tags: ['science'], text: 'Place this tile on land. Action: pay 2 M€ to draw a card.',
  play: (s, pid, id) => [{ k: 'tile', tile: 'special', rule: 'land', card: id }],
  action: { text: 'Pay 2 M€: draw a card', mc: 2, can: () => true, run: () => [DRAW(1)] },
});
addCE({ name: 'Robotic Workforce', type: 'automated', cost: 9, tags: ['science'], text: 'Copy the production effects of one of your building cards.', canPlay: (s, pid) => roboticTargets(s, pid).length > 0, play: () => [{ k: 'robotic' }] });
addCE({
  name: 'Sabotage', type: 'event', cost: 1, tags: [], text: 'Remove up to 3 titanium, 4 steel or 7 M€ from any player.',
  play: () => [CHOOSE('Sabotage', [{ label: 'Remove up to 3 titanium', ops: [{ k: 'removeAny', r: 'titanium', n: 3 }] }, { label: 'Remove up to 4 steel', ops: [{ k: 'removeAny', r: 'steel', n: 4 }] }, { label: 'Remove up to 7 M€', ops: [{ k: 'removeAny', r: 'mc', n: 7 }] }])],
});
addCE({ name: 'Satellites', type: 'automated', cost: 10, tags: ['space'], text: '+1 M€ production per space tag you have (this included).', play: (s, pid) => [PR('mc', tagCount(s, pid, 'space'))] });
addCE({
  name: 'Security Fleet', type: 'active', cost: 12, tags: ['space'], resource: 'fighter', vp: perRes(1), vpText: '1 VP per fighter', text: 'Action: spend 1 titanium to add a fighter here.',
  action: { text: 'Spend 1 titanium: add a fighter', can: (s, pid) => P(s, pid).res.titanium > 0, run: () => [R('titanium', -1), ADD_THIS(1)] },
});
addCE({
  name: 'Space Elevator', type: 'active', cost: 27, tags: ['space', 'building'], vp: 2, text: '+1 titanium production. Action: spend 1 steel to gain 5 M€.',
  play: () => [PR('titanium', 1)], action: { text: 'Spend 1 steel: gain 5 M€', can: (s, pid) => P(s, pid).res.steel > 0, run: () => [R('steel', -1), R('mc', 5)] },
});
addCE({ name: 'Space Station', type: 'active', cost: 10, tags: ['space'], vp: 1, discount: { tag: 'space', n: 2 }, text: 'Space cards cost you 2 M€ less.' });
addCE({ name: 'Sponsors', type: 'automated', cost: 6, tags: ['earth'], text: '+2 M€ production.', play: () => [PR('mc', 2)] });
addCE({ name: 'Standard Technology', type: 'active', cost: 6, tags: ['science'], text: 'After you pay for a standard project (except selling patents), gain 3 M€.', onSP: () => [R('mc', 3)] });
addCE({
  name: 'Tardigrades', type: 'active', cost: 4, tags: ['microbe'], resource: 'microbe', vp: perRes(4), vpText: '1 VP per 4 microbes', text: 'Action: add 1 microbe here.',
  action: { text: 'Add 1 microbe here', can: () => true, run: () => [ADD_THIS(1)] },
});
addCE({ name: 'Technology Demonstration', type: 'event', cost: 5, tags: ['science', 'space'], text: 'Draw 2 cards.', play: () => [DRAW(2)] });
addCE({ name: 'Terraforming Ganymede', type: 'automated', cost: 33, tags: ['jovian', 'space'], vp: 2, text: '+1 TR per Jovian tag you have (this included).', play: (s, pid) => [TR(tagCount(s, pid, 'jovian'))] });
addCE({ name: 'Titanium Mine', type: 'automated', cost: 7, tags: ['building'], text: '+1 titanium production.', play: () => [PR('titanium', 1)] });
addCE({ name: 'Toll Station', type: 'automated', cost: 12, tags: ['space'], text: "+1 M€ production per space tag your opponents have.", play: (s, pid) => [PR('mc', others(s, pid).reduce((a, p) => a + tagCount(s, p.id, 'space'), 0))] });
addCE({ name: 'Trans-Neptune Probe', type: 'automated', cost: 6, tags: ['science', 'space'], vp: 1, text: 'No effect beyond VP.' });
addCE({ name: 'Tropical Resort', type: 'automated', cost: 13, tags: ['building'], vp: 2, text: '−2 heat, +3 M€ production.', play: () => [PR('heat', -2), PR('mc', 3)] });
addCE({ name: 'Vesta Shipyard', type: 'automated', cost: 15, tags: ['jovian', 'space'], vp: 1, text: '+1 titanium production.', play: () => [PR('titanium', 1)] });
addCE({
  name: 'Viral Enhancers', type: 'active', cost: 9, tags: ['science', 'microbe'], text: 'Whenever you play a plant, microbe or animal tag (this included), gain 1 plant or add 1 resource to that card.',
  onCard: (s, owner, player, card) => {
    if (owner !== player) return [];
    const n = card.tags.filter((t) => t === 'plant' || t === 'animal' || t === 'microbe').length;
    const ops: Op[] = [];
    for (let i = 0; i < n; i++) {
      ops.push(card.resource && card.type !== 'event'
        ? CHOOSE('Viral Enhancers', [{ label: 'Gain 1 plant', ops: [R('plants', 1)] }, { label: `Add 1 resource to ${card.name}`, ops: [{ k: 'addRes', n: 1, target: 'this', card: card.id }] }])
        : R('plants', 1));
    }
    return ops;
  },
});
addCE({
  name: 'Virus', type: 'event', cost: 1, tags: ['microbe'], text: 'Remove up to 2 animals from any card, or up to 5 plants from any player.',
  play: () => [CHOOSE('Virus', [{ label: 'Remove up to 2 animals', ops: [{ k: 'removeCardRes', n: 2, rtype: 'animal' }] }, { label: 'Remove up to 5 plants', ops: [REMOVE_PLANTS(5)] }])],
});

// ---------- build the index ----------
export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const CARDS: Record<string, CardDef> = {};
for (const [group, set] of [[corpBase, 'base'], [corpCE, 'corp'], [list, 'base'], [corpEra, 'corp']] as const) {
  for (const c of group) {
    const id = slug(c.name);
    CARDS[id] = { ...c, id, set };
  }
}
export const PROJECT_IDS = Object.values(CARDS).filter((c) => c.type !== 'corp').map((c) => c.id);
export const CORP_IDS = Object.values(CARDS).filter((c) => c.type === 'corp' && c.id !== 'beginner-corporation').map((c) => c.id);

/** Whether `pid` shields its plants/animals/microbes from other players. */
export function protects(s: GameState, pid: number, r: 'plants' | 'animal' | 'microbe'): boolean {
  return P(s, pid).played.includes('protected-habitats') && (r === 'plants' || r === 'animal' || r === 'microbe');
}

/** Building cards whose production box Robotic Workforce can copy. */
export function roboticTargets(s: GameState, pid: number): string[] {
  return P(s, pid).played.filter((id) => {
    const c = CARDS[id];
    if (c.type === 'event' || !c.tags.includes('building') || !c.play) return false;
    if (ROBOTIC_EXCLUDED.has(id)) return false;
    const ops = c.play(s, pid, id).filter((o) => o.k === 'prod');
    if (!ops.length) return false;
    return ops.every((o) => o.k !== 'prod' || o.n >= 0 || (o.r === 'mc' ? P(s, pid).prod.mc + o.n >= -5 : P(s, pid).prod[o.r] + o.n >= 0));
  });
}
// Cards whose production depends on a choice or a later tile, which a copy can't reproduce.
const ROBOTIC_EXCLUDED = new Set(['mining-rights', 'mining-area']);

