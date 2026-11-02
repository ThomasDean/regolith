// Venus Next: 49 project cards and 5 corporations. Numbers follow the published game; effect
// wording is our own.
import type { CardDef } from './cards';
import { CARDS } from './cards';
import { P, cities, resCards, resOnCards, tagCount } from './helpers';
import { ADD_ANY, ADD_OTHER, ADD_THIS, CHOOSE, DRAW, PR, R, SPEND_THIS, TEMP, TR, VENUS, cityOn, CITY } from './ops';
import type { GameState } from './types';

type Def = Omit<CardDef, 'id' | 'set'>;
const here = (s: GameState, pid: number, id: string) => P(s, pid).cardRes[id] ?? 0;
const per = (n: number) => (s: GameState, pid: number, id: string) => Math.floor(here(s, pid, id) / n);
const VEJ = { tags: { venus: 1, earth: 1, jovian: 1 } };
const hasRes = (s: GameState, pid: number, rtype: 'floater' | 'microbe' | 'animal', tag?: 'venus' | 'jovian', exclude?: string) =>
  resCards(s, pid, rtype, tag).some((c) => c !== exclude);
const anyResVenus = (s: GameState, pid: number, exclude?: string) => resCards(s, pid, undefined, 'venus').some((c) => c !== exclude);

export const VENUS_CORPS: Def[] = [
  {
    name: 'Aphrodite', type: 'corp', cost: 0, tags: ['plant', 'venus'], startMC: 47,
    text: 'Start with 47 M€ and 1 plant production. Whenever Venus is raised a step (by anyone), gain 2 M€.',
    play: () => [PR('plants', 1)],
  },
  {
    name: 'Celestic', type: 'corp', cost: 0, tags: ['venus'], startMC: 42, resource: 'floater', vp: per(3), vpText: '1 VP per 3 floaters here',
    text: 'Start with 42 M€. First action: reveal cards until two have a floater icon; take those. Action: add a floater to any card.',
    firstAction: { text: 'Draw 2 floater cards', ops: [{ k: 'drawMatching', n: 2, rtype: 'floater' }] },
    action: { text: 'Add a floater to any card', can: () => true, run: () => [ADD_ANY('floater', 1)] },
  },
  {
    name: 'Manutech', type: 'corp', cost: 0, tags: ['building'], startMC: 35,
    text: 'Start with 35 M€ and 1 steel production. Whenever your production rises, gain that much of the resource too.',
    play: () => [PR('steel', 1)],
  },
  {
    name: 'Morning Star Inc.', type: 'corp', cost: 0, tags: ['venus'], startMC: 50,
    text: 'Start with 50 M€. First action: reveal cards until three have Venus tags; take those. Venus requirements are ±2 steps for you.',
    firstAction: { text: 'Draw 3 Venus cards', ops: [{ k: 'drawMatching', n: 3, tag: 'venus' }] },
  },
  {
    name: 'Viron', type: 'corp', cost: 0, tags: ['microbe'], startMC: 48,
    text: 'Start with 48 M€. Action: use the action of a card you already used this generation again.',
    action: {
      text: 'Reuse a card action', can: (s, pid) => P(s, pid).usedActions.some((c) => c !== 'viron' && CARDS[c].action?.can(s, pid, c)),
      run: () => [{ k: 'viron' }],
    },
  },
];

export const VENUS_PROJECTS: Def[] = [
  {
    name: 'Aerial Mappers', type: 'active', cost: 11, tags: ['venus'], resource: 'floater', vp: 1,
    text: 'Action: add a floater to any card, or spend a floater here to draw a card.',
    action: {
      text: 'Add a floater anywhere, or spend one here to draw', can: () => true,
      run: (s, pid, id) => [CHOOSE('Aerial Mappers', [{ label: 'Add a floater to any card', ops: [ADD_ANY('floater', 1)] }, { label: 'Spend a floater here: draw a card', ops: [SPEND_THIS(1), DRAW(1)], ok: here(s, pid, id) >= 1 }])],
    },
  },
  { name: 'Aerosport Tournament', type: 'event', cost: 7, tags: [], vp: 1, req: { floaters: 5 }, text: 'Needs 5 floaters on your cards. Gain 1 M€ per city in play.', play: (s) => [R('mc', cities(s).length)] },
  { name: 'Air-Scrapping Expedition', type: 'event', cost: 13, tags: ['venus'], text: 'Raise Venus 1 step. Add 3 floaters to any Venus card.', play: () => [VENUS(), ADD_ANY('floater', 3, 'venus')] },
  { name: 'Atalanta Planitia Lab', type: 'automated', cost: 10, tags: ['venus', 'science'], vp: 2, req: { tags: { science: 3 } }, text: 'Draw 2 cards.', play: () => [DRAW(2)] },
  {
    name: 'Atmoscoop', type: 'automated', cost: 22, tags: ['jovian', 'space'], vp: 1, req: { tags: { science: 3 } },
    text: 'Raise temperature 2 steps or Venus 2 steps. Add 2 floaters to any card.',
    play: () => [CHOOSE('Atmoscoop', [{ label: 'Raise temperature 2 steps', ops: [TEMP(2)] }, { label: 'Raise Venus 2 steps', ops: [VENUS(2)] }]), ADD_ANY('floater', 2)],
  },
  {
    name: 'Comet for Venus', type: 'event', cost: 11, tags: ['space'], text: 'Raise Venus 1 step. Remove up to 4 M€ from a player with a Venus tag in play.',
    play: (s, pid) => [VENUS(), { k: 'removeAny', r: 'mc', n: 4, among: s.players.filter((q) => q.id !== pid && tagCount(s, q.id, 'venus') > 0).map((q) => q.id) }],
  },
  { name: 'Corroder Suits', type: 'automated', cost: 8, tags: ['venus'], text: '+2 M€ production. Add 1 resource to any Venus card.', play: () => [PR('mc', 2), ADD_ANY(undefined, 1, 'venus')] },
  {
    name: 'Dawn City', type: 'automated', cost: 15, tags: ['city', 'space'], vp: 3, req: { tags: { science: 4 } },
    text: '−1 energy, +1 titanium production. Place a city on the Dawn City space (off Mars).', play: () => [PR('energy', -1), PR('titanium', 1), cityOn('dawnCity')],
  },
  {
    name: 'Deuterium Export', type: 'active', cost: 11, tags: ['space', 'venus', 'power'], resource: 'floater',
    text: 'Action: add a floater here, or spend one here for +1 energy production.',
    action: {
      text: 'Add a floater, or spend one for +1 energy production', can: () => true,
      run: (s, pid, id) => [CHOOSE('Deuterium Export', [{ label: 'Add a floater here', ops: [ADD_THIS(1)] }, { label: 'Spend a floater: +1 energy production', ops: [SPEND_THIS(1), PR('energy', 1)], ok: here(s, pid, id) >= 1 }])],
    },
  },
  {
    name: 'Dirigibles', type: 'active', cost: 11, tags: ['venus'], resource: 'floater', payWith: { rtype: 'floater', value: 3, tag: 'venus' },
    text: 'Floaters here may pay for Venus cards, 3 M€ each. Action: add a floater to any card.',
    action: { text: 'Add a floater to any card', can: () => true, run: () => [ADD_ANY('floater', 1)] },
  },
  {
    name: 'Extractor Balloons', type: 'active', cost: 21, tags: ['venus'], resource: 'floater',
    text: 'Add 3 floaters here. Action: add a floater here, or spend 2 here to raise Venus 1 step.', play: () => [ADD_THIS(3)],
    action: {
      text: 'Add a floater, or spend 2 to raise Venus', can: () => true,
      run: (s, pid, id) => [CHOOSE('Extractor Balloons', [{ label: 'Add a floater here', ops: [ADD_THIS(1)] }, { label: 'Spend 2 floaters: raise Venus', ops: [SPEND_THIS(2), VENUS()], ok: here(s, pid, id) >= 2 }])],
    },
  },
  {
    name: 'Extremophiles', type: 'active', cost: 3, tags: ['venus', 'microbe'], resource: 'microbe', vp: per(3), vpText: '1 VP per 3 microbes here', req: { tags: { science: 2 } },
    text: 'Action: add a microbe to any card.', action: { text: 'Add a microbe to any card', can: () => true, run: () => [ADD_ANY('microbe', 1)] },
  },
  {
    name: 'Floating Habs', type: 'active', cost: 5, tags: ['venus'], resource: 'floater', vp: per(2), vpText: '1 VP per 2 floaters here', req: { tags: { science: 2 } },
    text: 'Action: pay 2 M€ to add a floater to any card.', action: { text: 'Pay 2 M€: add a floater to any card', mc: 2, can: () => true, run: () => [ADD_ANY('floater', 1)] },
  },
  {
    name: 'Forced Precipitation', type: 'active', cost: 8, tags: ['venus'], resource: 'floater',
    text: 'Action: pay 2 M€ to add a floater here, or spend 2 here to raise Venus 1 step.',
    action: {
      text: 'Pay 2 M€ for a floater, or spend 2 to raise Venus', can: (s, pid, id) => P(s, pid).res.mc >= 2 || here(s, pid, id) >= 2,
      run: (s, pid, id) => [CHOOSE('Forced Precipitation', [{ label: 'Pay 2 M€: add a floater here', ops: [{ k: 'pay', n: 2 }, ADD_THIS(1)], ok: P(s, pid).res.mc >= 2 }, { label: 'Spend 2 floaters: raise Venus', ops: [SPEND_THIS(2), VENUS()], ok: here(s, pid, id) >= 2 }])],
    },
  },
  {
    name: 'Freyja Biodomes', type: 'automated', cost: 14, tags: ['plant', 'venus'], vp: 2, req: { venus: 10 },
    text: '−1 energy, +2 M€ production. Add 2 microbes or 2 animals to another Venus card.',
    play: (s, pid, id) => [PR('energy', -1), PR('mc', 2), CHOOSE('Freyja Biodomes', [
      { label: 'Add 2 microbes to a Venus card', ops: [ADD_OTHER('microbe', 2, 'venus')], ok: hasRes(s, pid, 'microbe', 'venus', id) },
      { label: 'Add 2 animals to a Venus card', ops: [ADD_OTHER('animal', 2, 'venus')], ok: hasRes(s, pid, 'animal', 'venus', id) },
    ])],
  },
  { name: 'GHG Import From Venus', type: 'event', cost: 23, tags: ['space', 'venus'], text: 'Raise Venus 1 step. +3 heat production.', play: () => [VENUS(), PR('heat', 3)] },
  { name: 'Giant Solar Shade', type: 'automated', cost: 27, tags: ['space', 'venus'], text: 'Raise Venus 3 steps.', play: () => [VENUS(3)] },
  {
    name: 'Gyropolis', type: 'automated', cost: 20, tags: ['city', 'building'], text: '−2 energy production, +1 M€ production per Venus and Earth tag you have. Place a city.',
    play: (s, pid) => [PR('energy', -2), PR('mc', tagCount(s, pid, 'venus') + tagCount(s, pid, 'earth')), CITY],
  },
  {
    name: 'Hydrogen to Venus', type: 'event', cost: 11, tags: ['space'], text: 'Raise Venus 1 step. Add 1 floater to a Venus card per Jovian tag you have.',
    play: (s, pid) => [VENUS(), ...(tagCount(s, pid, 'jovian') ? [ADD_ANY('floater', tagCount(s, pid, 'jovian'), 'venus')] : [])],
  },
  {
    name: 'Io Sulphur Research', type: 'automated', cost: 17, tags: ['science', 'jovian'], vp: 2, text: 'Draw a card, or 3 if you have at least 3 Venus tags.',
    play: (s, pid) => [DRAW(tagCount(s, pid, 'venus') >= 3 ? 3 : 1)],
  },
  { name: 'Ishtar Mining', type: 'automated', cost: 5, tags: ['venus'], req: { venus: 8 }, text: '+1 titanium production.', play: () => [PR('titanium', 1)] },
  {
    name: 'Jet Stream Microscrappers', type: 'active', cost: 12, tags: ['venus'], resource: 'floater',
    text: 'Action: spend 1 titanium to add 2 floaters here, or spend 2 here to raise Venus 1 step.',
    action: {
      text: 'Titanium for 2 floaters, or 2 floaters to raise Venus', can: (s, pid, id) => P(s, pid).res.titanium >= 1 || here(s, pid, id) >= 2,
      run: (s, pid, id) => [CHOOSE('Jet Stream Microscrappers', [{ label: 'Spend 1 titanium: add 2 floaters', ops: [R('titanium', -1), ADD_THIS(2)], ok: P(s, pid).res.titanium >= 1 }, { label: 'Spend 2 floaters: raise Venus', ops: [SPEND_THIS(2), VENUS()], ok: here(s, pid, id) >= 2 }])],
    },
  },
  {
    name: 'Local Shading', type: 'active', cost: 4, tags: ['venus'], resource: 'floater',
    text: 'Action: add a floater here, or spend one here for +1 M€ production.',
    action: {
      text: 'Add a floater, or spend one for +1 M€ production', can: () => true,
      run: (s, pid, id) => [CHOOSE('Local Shading', [{ label: 'Add a floater here', ops: [ADD_THIS(1)] }, { label: 'Spend a floater: +1 M€ production', ops: [SPEND_THIS(1), PR('mc', 1)], ok: here(s, pid, id) >= 1 }])],
    },
  },
  {
    name: 'Luna Metropolis', type: 'automated', cost: 21, tags: ['city', 'space', 'earth'], vp: 2,
    text: '+1 M€ production per Earth tag you have (this included). Place a city on the Luna Metropolis space (off Mars).',
    play: (s, pid) => [PR('mc', tagCount(s, pid, 'earth')), cityOn('lunaMetropolis')],
  },
  { name: 'Luxury Foods', type: 'automated', cost: 8, tags: [], vp: 2, req: VEJ, text: 'Needs a Venus, an Earth and a Jovian tag.' },
  {
    name: 'Maxwell Base', type: 'active', cost: 18, tags: ['city', 'venus'], vp: 3, req: { venus: 12 },
    text: '−1 energy production. Place a city on the Maxwell Base space (off Mars). Action: add 1 resource to another Venus card.',
    play: () => [PR('energy', -1), cityOn('maxwellBase')],
    action: { text: 'Add a resource to another Venus card', can: (s, pid, id) => anyResVenus(s, pid, id), run: () => [{ k: 'addRes', n: 1, target: 'other', tag: 'venus' }] },
  },
  { name: 'Mining Quota', type: 'automated', cost: 5, tags: ['building'], req: VEJ, text: '+2 steel production.', play: () => [PR('steel', 2)] },
  { name: 'Neutralizer Factory', type: 'automated', cost: 7, tags: ['venus'], req: { venus: 10 }, text: 'Raise Venus 1 step.', play: () => [VENUS()] },
  { name: 'Omnicourt', type: 'automated', cost: 11, tags: ['building'], req: VEJ, text: '+2 TR.', play: () => [TR(2)] },
  { name: 'Orbital Reflectors', type: 'automated', cost: 26, tags: ['venus', 'space'], text: 'Raise Venus 2 steps. +2 heat production.', play: () => [VENUS(2), PR('heat', 2)] },
  {
    name: 'Rotator Impacts', type: 'active', cost: 6, tags: ['space'], resource: 'asteroid', req: { venusMax: 14 },
    text: 'Action: pay 6 M€ (titanium may be used) to add an asteroid here, or spend one here to raise Venus 1 step.',
    action: {
      text: 'Pay 6 M€ for an asteroid, or spend one to raise Venus', can: () => true,
      run: (s, pid, id) => [CHOOSE('Rotator Impacts', [{ label: 'Pay 6 M€: add an asteroid', ops: [{ k: 'pay', n: 6, titanium: true }, ADD_THIS(1)] }, { label: 'Spend an asteroid: raise Venus', ops: [SPEND_THIS(1), VENUS()], ok: here(s, pid, id) >= 1 }])],
    },
  },
  { name: 'Sister Planet Support', type: 'automated', cost: 7, tags: ['venus', 'earth'], req: { tags: { venus: 1, earth: 1 } }, text: '+3 M€ production.', play: () => [PR('mc', 3)] },
  { name: 'Solarnet', type: 'automated', cost: 7, tags: [], vp: 1, req: VEJ, text: 'Draw 2 cards.', play: () => [DRAW(2)] },
  { name: 'Spin-Inducing Asteroid', type: 'event', cost: 16, tags: ['space'], req: { venusMax: 10 }, text: 'Raise Venus 2 steps.', play: () => [VENUS(2)] },
  {
    name: 'Sponsored Academies', type: 'automated', cost: 9, tags: ['earth', 'science'], vp: 1, text: 'Discard a card from your hand, then draw 3. Each opponent draws 1.',
    canPlay: (s, pid) => P(s, pid).hand.length >= 2, play: () => [{ k: 'discard', n: 1 }, DRAW(3), { k: 'othersDraw', n: 1 }],
  },
  {
    name: 'Stratopolis', type: 'active', cost: 22, tags: ['city', 'venus'], resource: 'floater', vp: per(3), vpText: '1 VP per 3 floaters here', req: { tags: { science: 2 } },
    text: '+2 M€ production. Place a city on the Stratopolis space (off Mars). Action: add 2 floaters to any Venus card.',
    play: () => [PR('mc', 2), cityOn('stratopolis')],
    action: { text: 'Add 2 floaters to any Venus card', can: () => true, run: () => [ADD_ANY('floater', 2, 'venus')] },
  },
  {
    name: 'Stratospheric Birds', type: 'active', cost: 12, tags: ['venus', 'animal'], resource: 'animal', vp: per(1), vpText: '1 VP per animal here', req: { venus: 12 },
    text: 'Spend 1 floater from any of your cards. Action: add an animal here.',
    canPlay: (s, pid) => resOnCards(s, pid, 'floater') > 0, play: () => [{ k: 'spendRes', n: 1, rtype: 'floater' }],
    action: { text: 'Add an animal here', can: () => true, run: () => [ADD_THIS(1)] },
  },
  {
    name: 'Sulphur-Eating Bacteria', type: 'active', cost: 6, tags: ['venus', 'microbe'], resource: 'microbe', req: { venus: 6 },
    text: 'Action: add a microbe here, or spend any number here for 3 M€ each.',
    action: {
      text: 'Add a microbe, or cash microbes in for 3 M€ each', can: () => true,
      run: (s, pid, id) => [CHOOSE('Sulphur-Eating Bacteria', [{ label: 'Add a microbe here', ops: [ADD_THIS(1)] }, { label: 'Spend microbes for 3 M€ each', ops: [{ k: 'amount', id: 'sulphur', title: 'Spend how many microbes (3 M€ each)?', max: here(s, pid, id) }], ok: here(s, pid, id) >= 1 }])],
    },
  },
  {
    name: 'Sulphur Exports', type: 'automated', cost: 21, tags: ['venus', 'space'], text: 'Raise Venus 1 step. +1 M€ production per Venus tag you have (this included).',
    play: (s, pid) => [VENUS(), PR('mc', tagCount(s, pid, 'venus'))],
  },
  { name: 'Terraforming Contract', type: 'automated', cost: 8, tags: ['earth'], req: { tr: 25 }, text: 'Needs a TR of 25. +4 M€ production.', play: () => [PR('mc', 4)] },
  {
    name: 'Thermophiles', type: 'active', cost: 9, tags: ['venus', 'microbe'], resource: 'microbe', req: { venus: 6 },
    text: 'Action: add a microbe to any Venus card, or spend 2 here to raise Venus 1 step.',
    action: {
      text: 'Add a microbe to a Venus card, or spend 2 to raise Venus', can: () => true,
      run: (s, pid, id) => [CHOOSE('Thermophiles', [{ label: 'Add a microbe to a Venus card', ops: [ADD_ANY('microbe', 1, 'venus')] }, { label: 'Spend 2 microbes: raise Venus', ops: [SPEND_THIS(2), VENUS()], ok: here(s, pid, id) >= 2 }])],
    },
  },
  { name: 'Venus Governor', type: 'automated', cost: 4, tags: ['venus', 'venus'], req: { tags: { venus: 2 } }, text: '+2 M€ production.', play: () => [PR('mc', 2)] },
  {
    name: 'Venus Magnetizer', type: 'active', cost: 7, tags: ['venus'], req: { venus: 10 }, text: 'Action: −1 energy production to raise Venus 1 step.',
    action: { text: '−1 energy production: raise Venus', can: (s, pid) => P(s, pid).prod.energy >= 1, run: () => [PR('energy', -1), VENUS()] },
  },
  { name: 'Venus Soils', type: 'automated', cost: 20, tags: ['venus', 'plant'], text: 'Raise Venus 1 step. +1 plant production. Add 2 microbes to another card.', play: () => [VENUS(), PR('plants', 1), ADD_OTHER('microbe', 2)] },
  { name: 'Venus Waystation', type: 'active', cost: 9, tags: ['venus', 'space'], vp: 1, discount: { tag: 'venus', n: 2 }, text: 'Venus cards cost you 2 M€ less.' },
  {
    name: 'Venusian Animals', type: 'active', cost: 15, tags: ['venus', 'animal', 'science'], resource: 'animal', vp: per(1), vpText: '1 VP per animal here', req: { venus: 18 },
    text: 'Whenever you play a science tag (this included), add an animal here.',
    onCard: (s, owner, player, card) => {
      const n = owner === player ? card.tags.filter((t) => t === 'science').length : 0;
      return n ? [{ k: 'addRes', n, target: 'this', card: 'venusian-animals' }] : [];
    },
  },
  {
    name: 'Venusian Insects', type: 'active', cost: 5, tags: ['venus', 'microbe'], resource: 'microbe', vp: per(2), vpText: '1 VP per 2 microbes here', req: { venus: 12 },
    text: 'Action: add a microbe here.', action: { text: 'Add a microbe here', can: () => true, run: () => [ADD_THIS(1)] },
  },
  {
    name: 'Venusian Plants', type: 'automated', cost: 13, tags: ['venus', 'plant'], vp: 1, req: { venus: 16 },
    text: 'Raise Venus 1 step. Add a microbe or an animal to another Venus card.',
    play: (s, pid, id) => [VENUS(), CHOOSE('Venusian Plants', [
      { label: 'Add a microbe to a Venus card', ops: [ADD_OTHER('microbe', 1, 'venus')], ok: hasRes(s, pid, 'microbe', 'venus', id) },
      { label: 'Add an animal to a Venus card', ops: [ADD_OTHER('animal', 1, 'venus')], ok: hasRes(s, pid, 'animal', 'venus', id) },
    ])],
  },
  { name: 'Water to Venus', type: 'event', cost: 9, tags: ['space'], text: 'Raise Venus 1 step.', play: () => [VENUS()] },
];
