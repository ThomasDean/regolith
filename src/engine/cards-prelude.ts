// Prelude: 35 prelude cards, 7 project cards and 5 corporations. Numbers follow the published
// game; effect wording is our own.
import type { CardDef } from './cards';
import { P, tagCount } from './helpers';
import { CITY, DRAW, GREEN, OCEAN, OXY, PR, R, TEMP, TR, ADD_THIS, cityOn } from './ops';

type Def = Omit<CardDef, 'id' | 'set'>;
const pre = (name: string, tags: CardDef['tags'], text: string, play: CardDef['play'], extra: Partial<Def> = {}): Def =>
  ({ name, type: 'prelude', cost: 0, tags, text, play, ...extra });

export const PRELUDE_CORPS: Def[] = [
  {
    name: 'Cheung Shing MARS', type: 'corp', cost: 0, tags: ['building'], startMC: 44, discount: { tag: 'building', n: 2 },
    text: 'Start with 44 M€ and 3 M€ production. Building cards cost you 2 M€ less.',
    play: () => [PR('mc', 3)],
  },
  {
    name: 'Point Luna', type: 'corp', cost: 0, tags: ['space', 'earth'], startMC: 38,
    text: 'Start with 38 M€ and 1 titanium production. Whenever you play an Earth tag (this included), draw a card.',
    play: () => [PR('titanium', 1)],
    onCard: (s, owner, player, card) => {
      if (owner !== player) return [];
      const n = card.tags.filter((t) => t === 'earth').length;
      return n ? [DRAW(n)] : [];
    },
  },
  {
    name: 'Robinson Industries', type: 'corp', cost: 0, tags: [], startMC: 47,
    text: 'Start with 47 M€. Action: pay 4 M€ to raise (one of) your lowest productions 1 step.',
    action: { text: 'Pay 4 M€: +1 to your lowest production', mc: 4, can: () => true, run: () => [{ k: 'lowestProd' }] },
  },
  {
    name: 'Valley Trust', type: 'corp', cost: 0, tags: ['earth'], startMC: 37, discount: { tag: 'science', n: 2 },
    text: 'Start with 37 M€. First action: draw 3 preludes and play one. Science cards cost you 2 M€ less.',
    firstAction: { text: 'Draw 3 preludes and play one', ops: [{ k: 'preludeDraw', n: 3 }] },
  },
  {
    name: 'Vitor', type: 'corp', cost: 0, tags: ['earth'], startMC: 45,
    text: 'Start with 45 M€. First action: fund an award for free. Whenever you play a card with positive VP (this included), gain 3 M€.',
    play: () => [R('mc', 3)],
    firstAction: { text: 'Fund an award for free', ops: [{ k: 'freeAward' }] },
    onCard: (s, owner, player, card) => (owner === player && card.id !== 'vitor' && positiveVP(card) ? [R('mc', 3)] : []),
  },
];

/** Whether a card shows a VP icon that isn't negative (dynamic VP counts). */
export const positiveVP = (c: CardDef) => (typeof c.vp === 'number' ? c.vp > 0 : typeof c.vp === 'function');

export const PRELUDES: Def[] = [
  pre('Acquired Space Agency', [], 'Gain 6 titanium. Reveal cards until two have space tags; take those.', () => [R('titanium', 6), { k: 'drawMatching', n: 2, tag: 'space' }]),
  pre('Allied Banks', ['earth'], '+4 M€ production. Gain 3 M€.', () => [PR('mc', 4), R('mc', 3)]),
  pre('Aquifer Turbines', ['power'], 'Place an ocean. +2 energy production. Pay 3 M€.', () => [R('mc', -3), PR('energy', 2), OCEAN]),
  pre('Biofuels', ['microbe'], '+1 energy and +1 plant production. Gain 2 plants.', () => [PR('energy', 1), PR('plants', 1), R('plants', 2)]),
  pre('Biolab', ['science'], '+1 plant production. Draw 3 cards.', () => [PR('plants', 1), DRAW(3)]),
  pre('Biosphere Support', ['plant'], '+2 plant production, −1 M€ production.', () => [PR('mc', -1), PR('plants', 2)]),
  pre('Business Empire', ['earth'], '+6 M€ production. Pay 6 M€.', () => [R('mc', -6), PR('mc', 6)]),
  pre('Dome Farming', ['plant', 'building'], '+2 M€ and +1 plant production.', () => [PR('mc', 2), PR('plants', 1)]),
  pre('Donation', [], 'Gain 21 M€.', () => [R('mc', 21)]),
  pre('Early Settlement', ['building', 'city'], '+1 plant production. Place a city.', () => [PR('plants', 1), CITY]),
  pre('Eccentric Sponsor', [], 'Play a card from your hand for 25 M€ less.', (s, pid, id) => [{ k: 'playFromHand', discount: 25, ignoreReq: false, src: id }]),
  pre('Ecology Experts', ['plant', 'microbe'], '+1 plant production. Play a card from your hand, ignoring global requirements.', (s, pid, id) => [PR('plants', 1), { k: 'playFromHand', discount: 0, ignoreReq: true, src: id }]),
  pre('Experimental Forest', ['plant'], 'Place a greenery. Reveal cards until two have plant tags; take those.', () => [GREEN, { k: 'drawMatching', n: 2, tag: 'plant' }]),
  pre('Galilean Mining', ['jovian'], '+2 titanium production. Pay 5 M€.', () => [R('mc', -5), PR('titanium', 2)]),
  pre('Great Aquifer', [], 'Place 2 oceans.', () => [OCEAN, OCEAN]),
  pre('Huge Asteroid', [], 'Raise temperature 3 steps. Pay 5 M€.', () => [R('mc', -5), TEMP(3)]),
  pre('Io Research Outpost', ['jovian', 'science'], '+1 titanium production. Draw a card.', () => [PR('titanium', 1), DRAW(1)]),
  pre('Loan', [], 'Gain 30 M€. −2 M€ production.', () => [PR('mc', -2), R('mc', 30)]),
  pre('Martian Industries', ['building'], '+1 energy and +1 steel production. Gain 6 M€.', () => [PR('energy', 1), PR('steel', 1), R('mc', 6)]),
  pre('Metal-Rich Asteroid', [], 'Raise temperature 1 step. Gain 4 titanium and 4 steel.', () => [TEMP(), R('titanium', 4), R('steel', 4)]),
  pre('Metals Company', [], '+1 M€, +1 steel and +1 titanium production.', () => [PR('mc', 1), PR('steel', 1), PR('titanium', 1)]),
  pre('Mining Operations', ['building'], '+2 steel production. Gain 4 steel.', () => [PR('steel', 2), R('steel', 4)]),
  pre('Mohole', ['building'], '+3 heat production. Gain 3 heat.', () => [PR('heat', 3), R('heat', 3)]),
  pre('Mohole Excavation', ['building'], '+1 steel and +2 heat production. Gain 2 heat.', () => [PR('steel', 1), PR('heat', 2), R('heat', 2)]),
  pre('Nitrogen Shipment', [], '+1 plant production. +1 TR. Gain 5 M€.', () => [PR('plants', 1), TR(1), R('mc', 5)]),
  pre('Orbital Construction Yard', ['space'], '+1 titanium production. Gain 4 titanium.', () => [PR('titanium', 1), R('titanium', 4)]),
  pre('Polar Industries', ['building'], '+2 heat production. Place an ocean.', () => [PR('heat', 2), OCEAN]),
  pre('Power Generation', ['power'], '+3 energy production.', () => [PR('energy', 3)]),
  pre('Research Network', ['wild'], '+1 M€ production. Draw 3 cards. The wild tag counts as any tag for requirements.', () => [PR('mc', 1), DRAW(3)]),
  pre('Self-Sufficient Settlement', ['building', 'city'], '+2 M€ production. Place a city.', () => [PR('mc', 2), CITY]),
  pre('Smelting Plant', ['building'], 'Raise oxygen 2 steps. Gain 5 steel.', () => [OXY(2), R('steel', 5)]),
  pre('Society Support', [], '+1 plant, +1 energy and +1 heat production, −1 M€ production.', () => [PR('mc', -1), PR('plants', 1), PR('energy', 1), PR('heat', 1)]),
  pre('Supplier', ['power'], '+2 energy production. Gain 4 steel.', () => [PR('energy', 2), R('steel', 4)]),
  pre('Supply Drop', [], 'Gain 3 titanium, 8 steel and 3 plants.', () => [R('titanium', 3), R('steel', 8), R('plants', 3)]),
  pre('UNMI Contractor', ['earth'], '+3 TR. Draw a card.', () => [TR(3), DRAW(1)]),
];

export const PRELUDE_PROJECTS: Def[] = [
  { name: 'House Printing', type: 'automated', cost: 10, tags: ['building'], vp: 1, text: '+1 steel production.', play: () => [PR('steel', 1)] },
  {
    name: 'Lava Tube Settlement', type: 'automated', cost: 15, tags: ['building', 'city'],
    text: '−1 energy, +2 M€ production. Place a city on a volcanic area, ignoring nearby cities (any land on maps without volcanoes).',
    play: () => [PR('energy', -1), PR('mc', 2), cityOn('volcanicCity')],
  },
  { name: 'Martian Survey', type: 'event', cost: 9, tags: ['science'], vp: 1, req: { oxyMax: 4 }, text: 'Draw 2 cards.', play: () => [DRAW(2)] },
  {
    name: 'Psychrophiles', type: 'active', cost: 2, tags: ['microbe'], resource: 'microbe', req: { tempMax: -20 },
    payWith: { rtype: 'microbe', value: 2, tag: 'plant' },
    text: 'Microbes here may pay for plant cards, 2 M€ each. Action: add 1 microbe here.',
    action: { text: 'Add 1 microbe here', can: () => true, run: () => [ADD_THIS(1)] },
  },
  { name: 'Research Coordination', type: 'automated', cost: 4, tags: ['wild'], text: 'The wild tag counts as any tag for requirements.' },
  { name: 'SF Memorial', type: 'automated', cost: 7, tags: ['building'], vp: 1, text: 'Draw a card.', play: () => [DRAW(1)] },
  { name: 'Space Hotels', type: 'automated', cost: 12, tags: ['space', 'earth'], req: { tags: { earth: 2 } }, text: '+4 M€ production.', play: () => [PR('mc', 4)] },
];

void P; void tagCount;
