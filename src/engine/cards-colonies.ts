// Colonies: 49 project cards and 5 corporations. Numbers follow the published game; effect
// wording is our own.
import type { CardDef } from './cards';
import { CARDS } from './cards';
import { P, allTags, cities, resCards, resOnCards, tagCount } from './helpers';
import { ADD_ANY, ADD_OTHER, ADD_THIS, CHOOSE, CITY, COLONY, DEC, DRAW, OCEAN, PR, R, REMOVE_PLANTS, SPEND_THIS, TR } from './ops';
import { colonyCount, coloniesInPlay } from './colonies';
import type { GameState } from './types';

type Def = Omit<CardDef, 'id' | 'set'>;
const here = (s: GameState, pid: number, id: string) => P(s, pid).cardRes[id] ?? 0;
const per = (n: number) => (s: GameState, pid: number, id: string) => Math.floor(here(s, pid, id) / n);
const jovianFloaters = (s: GameState, pid: number) => resCards(s, pid, 'floater', 'jovian').length > 0;
const FLEET = (n = 1) => ({ k: 'fleet' as const, n });

export const COLONY_CORPS: Def[] = [
  {
    name: 'Aridor', type: 'corp', cost: 0, tags: [], startMC: 40,
    text: 'Start with 40 M€. First action: put an extra colony tile into play. Whenever you get a new kind of tag in play (not events), +1 M€ production.',
    firstAction: { text: 'Add a colony tile', ops: [{ k: 'addColonyTile' }] },
  },
  {
    name: 'Arklight', type: 'corp', cost: 0, tags: ['animal'], startMC: 45, resource: 'animal', vp: per(2), vpText: '1 VP per 2 animals here',
    text: 'Start with 45 M€ and 2 M€ production. Whenever you play an animal or plant tag (this included), add an animal here.',
    play: () => [PR('mc', 2)],
    onCard: (s, owner, player, card) => {
      const n = owner === player ? card.tags.filter((t) => t === 'animal' || t === 'plant').length : 0;
      return n ? [{ k: 'addRes', n, target: 'this', card: 'arklight' }] : [];
    },
  },
  {
    name: 'Polyphemos', type: 'corp', cost: 0, tags: [], startMC: 50,
    text: 'Start with 50 M€, 5 M€ production and 5 titanium. Buying a card costs you 5 M€.',
    play: () => [PR('mc', 5), R('titanium', 5)],
  },
  {
    name: 'Poseidon', type: 'corp', cost: 0, tags: [], startMC: 45,
    text: 'Start with 45 M€. First action: place a colony. Whenever any colony is placed, +1 M€ production.',
    firstAction: { text: 'Place a colony', ops: [COLONY] },
  },
  {
    name: 'Stormcraft Incorporated', type: 'corp', cost: 0, tags: ['jovian'], startMC: 48, resource: 'floater',
    text: 'Start with 48 M€. Floaters here count as 2 heat each when you convert heat. Action: add a floater to any card.',
    action: { text: 'Add a floater to any card', can: () => true, run: () => [ADD_ANY('floater', 1)] },
  },
];

export const COLONY_PROJECTS: Def[] = [
  {
    name: 'Air Raid', type: 'event', cost: 0, tags: [], text: 'Spend a floater from any of your cards. Steal 5 M€ from any player.',
    canPlay: (s, pid) => resOnCards(s, pid, 'floater') > 0, play: () => [{ k: 'spendRes', n: 1, rtype: 'floater' }, { k: 'steal', r: 'mc', n: 5 }],
  },
  { name: 'Airliners', type: 'automated', cost: 11, tags: [], vp: 1, req: { floaters: 3 }, text: 'Needs 3 floaters on your cards. +2 M€ production. Add 2 floaters to any card.', play: () => [PR('mc', 2), ADD_ANY('floater', 2)] },
  {
    name: 'Atmo Collectors', type: 'active', cost: 15, tags: [], resource: 'floater',
    text: 'Add 2 floaters to any card. Action: add a floater here, or spend one here for 2 titanium, 3 energy or 4 heat.',
    play: () => [ADD_ANY('floater', 2)],
    action: {
      text: 'Add a floater, or spend one for titanium, energy or heat', can: () => true,
      run: (s, pid, id) => {
        const ok = here(s, pid, id) >= 1;
        return [CHOOSE('Atmo Collectors', [
          { label: 'Add a floater here', ops: [ADD_THIS(1)] },
          { label: 'Spend a floater: 2 titanium', ops: [SPEND_THIS(1), R('titanium', 2)], ok },
          { label: 'Spend a floater: 3 energy', ops: [SPEND_THIS(1), R('energy', 3)], ok },
          { label: 'Spend a floater: 4 heat', ops: [SPEND_THIS(1), R('heat', 4)], ok },
        ])];
      },
    },
  },
  {
    name: 'Community Services', type: 'automated', cost: 13, tags: [], vp: 1, text: '+1 M€ production per card you have with no tags (this included).',
    play: (s, pid) => {
      const p = P(s, pid);
      const ids = p.corp ? [p.corp, ...p.played] : p.played;
      return [PR('mc', ids.filter((id) => CARDS[id].type !== 'event' && !CARDS[id].tags.length).length)];
    },
  },
  { name: 'Conscription', type: 'event', cost: 5, tags: ['earth'], vp: -1, req: { tags: { earth: 2 } }, text: 'The next card you play this generation costs 16 M€ less.' },
  { name: 'Corona Extractor', type: 'automated', cost: 10, tags: ['space', 'power'], req: { tags: { science: 4 } }, text: '+4 energy production.', play: () => [PR('energy', 4)] },
  { name: 'Cryo-Sleep', type: 'active', cost: 10, tags: ['science'], vp: 1, tradeDiscount: 1, text: 'Trading costs you 1 resource less.' },
  { name: 'Earth Elevator', type: 'automated', cost: 43, tags: ['space', 'earth'], vp: 4, text: '+3 titanium production.', play: () => [PR('titanium', 3)] },
  {
    name: 'Ecology Research', type: 'automated', cost: 21, tags: ['science', 'plant', 'animal', 'microbe'], vp: 1,
    text: '+1 plant production per colony you have. Add an animal to another card and 2 microbes to another card.',
    play: (s, pid) => [PR('plants', colonyCount(s, pid)), ADD_OTHER('animal', 1), ADD_OTHER('microbe', 2)],
  },
  { name: 'Floater Leasing', type: 'automated', cost: 3, tags: [], text: '+1 M€ production per 3 floaters you have.', play: (s, pid) => [PR('mc', Math.floor(resOnCards(s, pid, 'floater') / 3))] },
  { name: 'Floater Prototypes', type: 'event', cost: 2, tags: ['science'], text: 'Add 2 floaters to another card.', play: () => [ADD_OTHER('floater', 2)] },
  {
    name: 'Floater Technology', type: 'active', cost: 7, tags: ['science'], text: 'Action: add a floater to another card.',
    action: { text: 'Add a floater to another card', can: (s, pid) => resCards(s, pid, 'floater').length > 0, run: () => [ADD_OTHER('floater', 1)] },
  },
  { name: 'Galilean Waystation', type: 'automated', cost: 15, tags: ['space'], vp: 1, text: '+1 M€ production per Jovian tag in play (everyone’s).', play: (s) => [PR('mc', allTags(s, 'jovian'))] },
  { name: 'Heavy Taxation', type: 'automated', cost: 3, tags: ['earth'], vp: -1, req: { tags: { earth: 2 } }, text: '+2 M€ production. Gain 4 M€.', play: () => [PR('mc', 2), R('mc', 4)] },
  { name: 'Ice Moon Colony', type: 'automated', cost: 23, tags: ['space'], text: 'Place a colony and an ocean.', play: () => [COLONY, OCEAN] },
  { name: 'Impactor Swarm', type: 'event', cost: 11, tags: ['space'], req: { tags: { jovian: 2 } }, text: 'Gain 12 heat. Remove up to 2 plants from any player.', play: () => [R('heat', 12), REMOVE_PLANTS(2)] },
  { name: 'Interplanetary Colony Ship', type: 'event', cost: 12, tags: ['space', 'earth'], text: 'Place a colony.', play: () => [COLONY] },
  {
    name: 'Jovian Lanterns', type: 'active', cost: 20, tags: ['jovian'], resource: 'floater', vp: per(2), vpText: '1 VP per 2 floaters here', req: { tags: { jovian: 1 } },
    text: '+1 TR. Add 2 floaters to any card. Action: spend 1 titanium to add 2 floaters here.', play: () => [TR(1), ADD_ANY('floater', 2)],
    action: { text: 'Spend 1 titanium: add 2 floaters here', can: (s, pid) => P(s, pid).res.titanium >= 1, run: () => [R('titanium', -1), ADD_THIS(2)] },
  },
  {
    name: 'Jupiter Floating Station', type: 'active', cost: 9, tags: ['jovian'], resource: 'floater', vp: 1, req: { tags: { science: 3 } },
    text: 'Action: add a floater to a Jovian card, or gain 1 M€ per floater here (at most 4).',
    action: {
      text: 'Floater to a Jovian card, or 1 M€ per floater here', can: () => true,
      run: (s, pid, id) => [CHOOSE('Jupiter Floating Station', [{ label: 'Add a floater to a Jovian card', ops: [ADD_ANY('floater', 1, 'jovian')] }, { label: `Gain ${Math.min(4, here(s, pid, id))} M€`, ops: [R('mc', Math.min(4, here(s, pid, id)))], ok: here(s, pid, id) > 0 }])],
    },
  },
  { name: 'Luna Governor', type: 'automated', cost: 4, tags: ['earth', 'earth'], req: { tags: { earth: 3 } }, text: '+2 M€ production.', play: () => [PR('mc', 2)] },
  {
    name: 'Lunar Exports', type: 'automated', cost: 19, tags: ['earth', 'space'], text: '+5 M€ production, or +2 plant production.',
    play: () => [CHOOSE('Lunar Exports', [{ label: '+5 M€ production', ops: [PR('mc', 5)] }, { label: '+2 plant production', ops: [PR('plants', 2)] }])],
  },
  { name: 'Lunar Mining', type: 'automated', cost: 11, tags: ['earth'], text: '+1 titanium production per 2 Earth tags you have (this included).', play: (s, pid) => [PR('titanium', Math.floor(tagCount(s, pid, 'earth') / 2))] },
  {
    name: 'Market Manipulation', type: 'event', cost: 1, tags: ['earth'], text: 'Raise one colony tile’s track 1 step and lower another’s 1 step.',
    canPlay: (s) => coloniesInPlay(s).filter((c) => c.active).length >= 2, play: () => [{ k: 'marketManip' }],
  },
  {
    name: 'Martian Zoo', type: 'active', cost: 12, tags: ['animal', 'building'], resource: 'animal', vp: 1, req: { citiesAll: 2 },
    text: 'Needs 2 cities in play. Whenever you play an Earth tag, add an animal here. Action: gain 1 M€ per animal here.',
    onCard: (s, owner, player, card) => {
      const n = owner === player ? card.tags.filter((t) => t === 'earth').length : 0;
      return n ? [{ k: 'addRes', n, target: 'this', card: 'martian-zoo' }] : [];
    },
    action: { text: 'Gain 1 M€ per animal here', can: (s, pid, id) => here(s, pid, id) > 0, run: (s, pid, id) => [R('mc', here(s, pid, id))] },
  },
  { name: 'Mining Colony', type: 'automated', cost: 20, tags: ['space'], text: '+1 titanium production. Place a colony.', play: () => [PR('titanium', 1), COLONY] },
  { name: 'Minority Refuge', type: 'automated', cost: 5, tags: ['space'], text: '−2 M€ production. Place a colony.', play: () => [PR('mc', -2), COLONY] },
  {
    name: 'Molecular Printing', type: 'automated', cost: 11, tags: ['science'], vp: 1, text: 'Gain 1 M€ per city in play and 1 M€ per colony in play.',
    play: (s) => [R('mc', cities(s).length + coloniesInPlay(s).reduce((a, c) => a + c.colonies.length, 0))],
  },
  { name: 'Nitrogen from Titan', type: 'automated', cost: 25, tags: ['jovian', 'space'], vp: 1, text: '+2 TR. Add 2 floaters to a Jovian card.', play: () => [TR(2), ADD_ANY('floater', 2, 'jovian')] },
  { name: 'Pioneer Settlement', type: 'automated', cost: 13, tags: ['space'], vp: 2, req: { coloniesMax: 1 }, text: 'Needs no more than 1 colony of yours. −2 M€ production. Place a colony.', play: () => [PR('mc', -2), COLONY] },
  { name: 'Productive Outpost', type: 'automated', cost: 0, tags: [], text: 'Gain the colony bonus of every colony you have.', play: () => [{ k: 'colonyBonuses' }] },
  {
    name: 'Quantum Communications', type: 'automated', cost: 8, tags: [], vp: 1, req: { tags: { science: 4 } }, text: '+1 M€ production per colony in play.',
    play: (s) => [PR('mc', coloniesInPlay(s).reduce((a, c) => a + c.colonies.length, 0))],
  },
  {
    name: 'Red Spot Observatory', type: 'active', cost: 17, tags: ['jovian', 'science'], resource: 'floater', vp: 2, req: { tags: { science: 3 } },
    text: 'Draw 2 cards. Action: add a floater here, or spend one here to draw a card.', play: () => [DRAW(2)],
    action: {
      text: 'Add a floater, or spend one to draw', can: () => true,
      run: (s, pid, id) => [CHOOSE('Red Spot Observatory', [{ label: 'Add a floater here', ops: [ADD_THIS(1)] }, { label: 'Spend a floater: draw a card', ops: [SPEND_THIS(1), DRAW(1)], ok: here(s, pid, id) >= 1 }])],
    },
  },
  {
    name: 'Refugee Camps', type: 'active', cost: 10, tags: ['earth'], resource: 'camp', vp: per(1), vpText: '1 VP per camp here',
    text: 'Action: −1 M€ production to add a camp here.', action: { text: '−1 M€ production: add a camp', can: (s, pid) => P(s, pid).prod.mc > -5, run: () => [PR('mc', -1), ADD_THIS(1)] },
  },
  { name: 'Research Colony', type: 'automated', cost: 20, tags: ['space', 'science'], text: 'Place a colony, even where you already have one. Draw 2 cards.', play: () => [{ k: 'colony', dup: true }, DRAW(2)] },
  { name: 'Rim Freighters', type: 'active', cost: 4, tags: ['space'], tradeDiscount: 1, text: 'Trading costs you 1 resource less.' },
  { name: 'Sky Docks', type: 'active', cost: 18, tags: ['space', 'earth'], vp: 2, req: { tags: { earth: 2 } }, discount: { n: 1 }, text: 'Gain a trade fleet. Cards cost you 1 M€ less.', play: () => [FLEET()] },
  { name: 'Solar Probe', type: 'event', cost: 9, tags: ['space', 'science'], vp: 1, text: 'Draw a card per 3 science tags you have (this included).', play: (s, pid) => [DRAW(Math.floor(tagCount(s, pid, 'science') / 3))] },
  { name: 'Solar Reflectors', type: 'automated', cost: 23, tags: ['space'], text: '+5 heat production.', play: () => [PR('heat', 5)] },
  {
    name: 'Space Port', type: 'automated', cost: 22, tags: ['city', 'building'], req: { colonies: 1 },
    text: 'Needs a colony. −1 energy, +4 M€ production. Place a city. Gain a trade fleet.', play: () => [PR('energy', -1), PR('mc', 4), CITY, FLEET()],
  },
  {
    name: 'Space Port Colony', type: 'automated', cost: 27, tags: ['space'], req: { colonies: 1 },
    vp: (s) => Math.floor(coloniesInPlay(s).reduce((a, c) => a + c.colonies.length, 0) / 2), vpText: '1 VP per 2 colonies in play',
    text: 'Needs a colony. Place a colony, even where you already have one. Gain a trade fleet.', play: () => [{ k: 'colony', dup: true }, FLEET()],
  },
  {
    name: 'Spin-off Department', type: 'active', cost: 10, tags: ['building'], text: '+2 M€ production. Whenever you play a card costing 20 M€ or more (printed), draw a card.',
    play: () => [PR('mc', 2)], onCard: (s, owner, player, card) => (owner === player && card.cost >= 20 && card.type !== 'prelude' ? [DRAW(1)] : []),
  },
  {
    name: 'Sub-zero Salt Fish', type: 'active', cost: 5, tags: ['animal'], resource: 'animal', vp: per(2), vpText: '1 VP per 2 animals here', req: { temp: -6 },
    text: 'Decrease any plant production 1 step. Action: add an animal here.',
    canPlay: (s) => s.players.some((q) => q.prod.plants >= 1), play: () => [DEC('plants', 1)],
    action: { text: 'Add an animal here', can: () => true, run: () => [ADD_THIS(1)] },
  },
  {
    name: 'Titan Air-scrapping', type: 'active', cost: 21, tags: ['jovian'], resource: 'floater', vp: 2,
    text: 'Action: spend 1 titanium to add 2 floaters here, or spend 2 here for +1 TR.',
    action: {
      text: 'Titanium for 2 floaters, or 2 floaters for 1 TR', can: (s, pid, id) => P(s, pid).res.titanium >= 1 || here(s, pid, id) >= 2,
      run: (s, pid, id) => [CHOOSE('Titan Air-scrapping', [{ label: 'Spend 1 titanium: add 2 floaters', ops: [R('titanium', -1), ADD_THIS(2)], ok: P(s, pid).res.titanium >= 1 }, { label: 'Spend 2 floaters: +1 TR', ops: [SPEND_THIS(2), TR(1)], ok: here(s, pid, id) >= 2 }])],
    },
  },
  {
    name: 'Titan Floating Launch-pad', type: 'active', cost: 18, tags: ['jovian'], resource: 'floater', vp: 1,
    text: 'Add 2 floaters to any Jovian card. Action: add a floater to any Jovian card, or spend one here to trade for free.',
    play: () => [ADD_ANY('floater', 2, 'jovian')],
    action: {
      text: 'Floater to a Jovian card, or spend one to trade for free', can: () => true,
      run: (s, pid, id) => [CHOOSE('Titan Floating Launch-pad', [
        { label: 'Add a floater to a Jovian card', ops: [ADD_ANY('floater', 1, 'jovian')], ok: jovianFloaters(s, pid) },
        { label: 'Spend a floater: trade for free', ops: [SPEND_THIS(1), { k: 'trade', free: true }], ok: here(s, pid, id) >= 1 && canTradeAny(s, pid) },
      ])],
    },
  },
  {
    name: 'Titan Shuttles', type: 'active', cost: 23, tags: ['jovian', 'space'], resource: 'floater', vp: 1,
    text: 'Action: add 2 floaters to any Jovian card, or spend any number here for that much titanium.',
    action: {
      text: 'Floaters to a Jovian card, or floaters for titanium', can: () => true,
      run: (s, pid, id) => [CHOOSE('Titan Shuttles', [
        { label: 'Add 2 floaters to a Jovian card', ops: [ADD_ANY('floater', 2, 'jovian')] },
        { label: 'Spend floaters here for titanium', ops: [{ k: 'amount', id: 'titanShuttles', title: 'Spend how many floaters (1 titanium each)?', max: here(s, pid, id) }], ok: here(s, pid, id) >= 1 },
      ])],
    },
  },
  { name: 'Trade Envoys', type: 'active', cost: 6, tags: [], tradeOffset: 1, text: 'When you trade, you may first raise that colony tile’s track 1 step.' },
  { name: 'Trading Colony', type: 'active', cost: 18, tags: ['space'], tradeOffset: 1, text: 'Place a colony. When you trade, you may first raise that colony tile’s track 1 step.', play: () => [COLONY] },
  {
    name: 'Urban Decomposers', type: 'automated', cost: 6, tags: ['microbe'], req: { colonies: 1, cities: 1 },
    text: 'Needs a city and a colony of yours. +1 plant production. Add 2 microbes to another card.', play: () => [PR('plants', 1), ADD_OTHER('microbe', 2)],
  },
  { name: 'Warp Drive', type: 'active', cost: 14, tags: ['science'], vp: 2, req: { tags: { science: 5 } }, discount: { tag: 'space', n: 4 }, text: 'Space cards cost you 4 M€ less.' },
];

/** Whether the player has a fleet free and a tile to send it to. */
function canTradeAny(s: GameState, pid: number): boolean {
  const p = P(s, pid);
  return (p.fleets ?? 0) > (p.fleetsUsed ?? 0) && coloniesInPlay(s).some((c) => c.active && c.fleet === null);
}
