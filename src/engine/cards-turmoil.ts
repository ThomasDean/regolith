// Turmoil: 17 project cards and 5 corporations. Numbers follow the published game; effect
// wording is our own.
import type { CardDef } from './cards';
import { P, allTags, ownedTiles, tagCount } from './helpers';
import { neighbours, onMars } from './board';
import { CHOOSE, CITY, DELEGATES, DRAW, GREEN, PR, R, REMOVE_PLANTS, TR } from './ops';
import { T, isChairman, leaders } from './turmoil';
import { PARTIES, NEUTRAL, type GameState, type Res } from './types';

type Def = Omit<CardDef, 'id' | 'set'>;
const here = (s: GameState, pid: number, id: string) => P(s, pid).cardRes[id] ?? 0;

export const TURMOIL_CORPS: Def[] = [
  {
    name: 'Lakefront Resorts', type: 'corp', cost: 0, tags: ['building'], startMC: 54,
    text: 'Start with 54 M€. Whenever any ocean is placed, +1 M€ production. You get 3 M€ (not 2) for each ocean next to a tile you place.',
    onTile: (s, owner, placer, sp) => (sp.tile?.kind === 'ocean' ? [PR('mc', 1)] : []),
  },
  {
    name: 'Pristar', type: 'corp', cost: 0, tags: [], startMC: 53, resource: 'preservation', vp: (s, pid, id) => here(s, pid, id), vpText: '1 VP per preservation here',
    text: 'Start with 53 M€; lower your TR 2 steps. At production, if your TR didn’t rise this generation, add a preservation here and gain 6 M€.',
    play: () => [TR(-2)],
    onProduction: (s, pid) => (P(s, pid).trRaisedThisGen ? [] : [{ k: 'addRes', n: 1, target: 'this', card: 'pristar' }, R('mc', 6)]),
  },
  {
    name: 'Septem Tribus', type: 'corp', cost: 0, tags: ['wild'], startMC: 36,
    text: 'Start with 36 M€. The wild tag counts as any tag for requirements. Action: gain 2 M€ per party with a delegate of yours.',
    action: {
      text: '2 M€ per party you have a delegate in', can: (s) => !!s.turmoil,
      run: (s, pid) => [R('mc', 2 * PARTIES.filter((p) => T(s).parties[p].delegates.includes(pid)).length)],
    },
  },
  {
    name: 'TerraLabs Research', type: 'corp', cost: 0, tags: ['science', 'earth'], startMC: 14,
    text: 'Start with 14 M€; lower your TR 1 step. Buying a card costs you 1 M€.', play: () => [TR(-1)],
  },
  {
    name: 'Utopia Invest', type: 'corp', cost: 0, tags: ['building'], startMC: 40,
    text: 'Start with 40 M€, 1 steel and 1 titanium production. Action: lower one of your productions 1 step to gain 4 of that resource.',
    play: () => [PR('steel', 1), PR('titanium', 1)],
    action: {
      text: 'Trade a production step for 4 of the resource', can: (s, pid) => (['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]).some((r) => (r === 'mc' ? P(s, pid).prod.mc > -5 : P(s, pid).prod[r] > 0)),
      run: (s, pid) => [CHOOSE('Utopia Invest', (['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]).map((r) => ({
        label: `−1 ${r === 'mc' ? 'M€' : r} production: gain 4`, ops: [PR(r, -1), R(r, 4)], ok: r === 'mc' ? P(s, pid).prod.mc > -5 : P(s, pid).prod[r] > 0,
      })))],
    },
  },
];

const emptyNextToMine = (s: GameState, pid: number) => {
  const seen = new Set<string>();
  for (const t of ownedTiles(s, pid).filter(onMars)) for (const n of neighbours(s.board, t.id)) if (!n.tile && n.type !== 'off') seen.add(n.id);
  return seen.size;
};

export const TURMOIL_PROJECTS: Def[] = [
  { name: 'Aerial Lenses', type: 'automated', cost: 2, tags: [], vp: -1, req: { party: 'kelvinists' }, text: 'Needs Kelvinists ruling or 2 delegates there. Remove up to 2 plants from any player. +2 heat production.', play: () => [REMOVE_PLANTS(2), PR('heat', 2)] },
  {
    name: 'Banned Delegate', type: 'event', cost: 0, tags: [], req: { chairman: true }, text: 'Needs you to be chairman. Remove any delegate that isn’t a party leader.',
    canPlay: (s) => !!s.turmoil && PARTIES.some((p) => T(s).parties[p].delegates.length > 1), play: () => [{ k: 'removeDelegate' }],
  },
  {
    name: 'Cultural Metropolis', type: 'automated', cost: 20, tags: ['city', 'building'], req: { party: 'unity' },
    text: 'Needs Unity ruling or 2 delegates there. −1 energy, +3 M€ production. Place a city. Place 2 delegates in one party.',
    play: () => [PR('energy', -1), PR('mc', 3), CITY, DELEGATES(2, true)],
  },
  { name: 'Diaspora Movement', type: 'automated', cost: 7, tags: ['jovian'], vp: 1, req: { party: 'reds' }, text: 'Needs Reds ruling or 2 delegates there. Gain 1 M€ per Jovian tag in play (this included).', play: (s) => [R('mc', allTags(s, 'jovian'))] },
  { name: 'Event Analysts', type: 'active', cost: 5, tags: ['science'], req: { party: 'scientists' }, influence: 1, text: 'Needs Scientists ruling or 2 delegates there. You have +1 influence.' },
  {
    name: 'GMO Contract', type: 'active', cost: 3, tags: ['microbe', 'science'], req: { party: 'greens' }, text: 'Needs Greens ruling or 2 delegates there. Whenever you play a plant, animal or microbe tag (this included), gain 2 M€.',
    onCard: (s, owner, player, card) => {
      const n = owner === player ? card.tags.filter((t) => t === 'plant' || t === 'animal' || t === 'microbe').length : 0;
      return n ? [R('mc', 2 * n)] : [];
    },
  },
  {
    name: 'Martian Media Center', type: 'active', cost: 7, tags: ['building'], req: { party: 'mars' },
    text: 'Needs Mars First ruling or 2 delegates there. +2 M€ production. Action: pay 3 M€ to place a delegate in any party.',
    play: () => [PR('mc', 2)],
    action: { text: 'Pay 3 M€: place a delegate', mc: 3, can: (s, pid) => !!s.turmoil && T(s).reserve[pid] > 0, run: () => [DELEGATES(1)] },
  },
  { name: 'PR Office', type: 'automated', cost: 7, tags: ['earth'], req: { party: 'unity' }, text: 'Needs Unity ruling or 2 delegates there. +1 TR. Gain 1 M€ per Earth tag you have (this included).', play: (s, pid) => [TR(1), R('mc', tagCount(s, pid, 'earth'))] },
  { name: 'Parliament Hall', type: 'automated', cost: 8, tags: ['building'], vp: 1, req: { party: 'mars' }, text: 'Needs Mars First ruling or 2 delegates there. +1 M€ production per 3 building tags you have (this included).', play: (s, pid) => [PR('mc', Math.floor(tagCount(s, pid, 'building') / 3))] },
  { name: 'Political Alliance', type: 'event', cost: 4, tags: [], req: { leaders: 2 }, text: 'Needs 2 party leaders of yours. +1 TR.', play: () => [TR(1)] },
  { name: 'Public Celebrations', type: 'event', cost: 8, tags: [], vp: 2, req: { chairman: true }, text: 'Needs you to be chairman.' },
  {
    name: 'Recruitment', type: 'event', cost: 2, tags: [], text: 'Swap a neutral delegate that isn’t a party leader for one of yours from the reserve.',
    canPlay: (s, pid) => !!s.turmoil && T(s).reserve[pid] > 0 && PARTIES.some((p) => T(s).parties[p].delegates.filter((d) => d === NEUTRAL).length > (T(s).parties[p].leader === NEUTRAL ? 1 : 0)),
    play: () => [{ k: 'recruit' }],
  },
  { name: 'Red Tourism Wave', type: 'event', cost: 3, tags: ['earth'], req: { party: 'reds' }, text: 'Needs Reds ruling or 2 delegates there. Gain 1 M€ per empty space next to your tiles on Mars.', play: (s, pid) => [R('mc', emptyNextToMine(s, pid))] },
  { name: 'Sponsored Mohole', type: 'automated', cost: 5, tags: ['building'], req: { party: 'kelvinists' }, text: 'Needs Kelvinists ruling or 2 delegates there. +2 heat production.', play: () => [PR('heat', 2)] },
  { name: 'Supported Research', type: 'automated', cost: 3, tags: ['science'], req: { party: 'scientists' }, text: 'Needs Scientists ruling or 2 delegates there. Draw 2 cards.', play: () => [DRAW(2)] },
  {
    name: 'Vote Of No Confidence', type: 'event', cost: 5, tags: [], req: { leaders: 1 },
    text: 'Needs a party leader of yours and a neutral chairman. Replace the chairman with your own delegate. +1 TR.',
    canPlay: (s, pid) => !!s.turmoil && T(s).chairman === NEUTRAL && T(s).reserve[pid] > 0, play: () => [{ k: 'noConfidence' }, TR(1)],
  },
  { name: 'Wildlife Dome', type: 'automated', cost: 15, tags: ['animal', 'plant', 'building'], req: { party: 'greens' }, text: 'Needs Greens ruling or 2 delegates there. Place a greenery.', play: () => [GREEN] },
];

void isChairman; void leaders;
