// Turmoil: the six parties (ruling bonus and policy), the global events, and the delegate rules.
// Delegates are player ids, or NEUTRAL (-1). Party order matters for ties in dominance.
import type { GameState, Op, PartyId, PartyState, Res, TurmoilState } from './types';
import { NEUTRAL, PARTIES, TAGS } from './types';
import { CARDS } from './cards';
import { P, allTags, cities, eventsPlayed, marsTiles, ownedTiles, resCards, tagCount } from './helpers';
import { neighbours } from './board';
import { colonyCount } from './colonies';
import { nextRandom } from './rng';

export const DELEGATES_PER_PLAYER = 7;
export const NEUTRAL_DELEGATES = 14;
/** M€ for a delegate from the reserve after the free one each generation */
export const DELEGATE_COST = 5;

export interface PartyDef {
  id: PartyId;
  name: string;
  color: string;
  bonusText: string;
  bonus: (s: GameState, pid: number) => Op[];
  policyText: string;
  /** a ruling-party action anyone can take (Scientists once a generation, Kelvinists any number) */
  policyAction?: { text: string; cost: number; once: boolean; ops: Op[] };
}

const R = (r: Res, n: number): Op => ({ k: 'res', r, n });

export const PARTY_DEFS: Record<PartyId, PartyDef> = {
  mars: {
    id: 'mars', name: 'Mars First', color: '#c0573a',
    bonusText: '1 M€ per building tag you have', bonus: (s, pid) => [R('mc', tagCount(s, pid, 'building'))],
    policyText: 'When you place a tile on Mars, gain 1 steel.',
  },
  scientists: {
    id: 'scientists', name: 'Scientists', color: '#e8e4d8',
    bonusText: '1 M€ per science tag you have', bonus: (s, pid) => [R('mc', tagCount(s, pid, 'science'))],
    policyText: 'Action (once a generation): pay 10 M€ to draw 3 cards.',
    policyAction: { text: 'Pay 10 M€: draw 3 cards', cost: 10, once: true, ops: [{ k: 'draw', n: 3 }] },
  },
  unity: {
    id: 'unity', name: 'Unity', color: '#6f8fc9',
    bonusText: '1 M€ per Venus, Earth and Jovian tag you have', bonus: (s, pid) => [R('mc', tagCount(s, pid, 'venus') + tagCount(s, pid, 'earth') + tagCount(s, pid, 'jovian'))],
    policyText: 'Titanium is worth 1 M€ extra.',
  },
  greens: {
    id: 'greens', name: 'Greens', color: '#5aa35a',
    bonusText: '1 M€ per plant, microbe and animal tag you have', bonus: (s, pid) => [R('mc', tagCount(s, pid, 'plant') + tagCount(s, pid, 'microbe') + tagCount(s, pid, 'animal'))],
    policyText: 'When you place a greenery, gain 4 M€.',
  },
  reds: {
    id: 'reds', name: 'Reds', color: '#a3323a',
    bonusText: 'The player(s) with the lowest TR gain 1 TR', bonus: (s, pid) => (s.players.every((q) => q.tr >= P(s, pid).tr) ? [{ k: 'tr', n: 1 }] : []),
    policyText: 'Whenever you raise your TR in an action, pay 3 M€ per step.',
  },
  kelvinists: {
    id: 'kelvinists', name: 'Kelvinists', color: '#d8902f',
    bonusText: '1 M€ per heat production you have', bonus: (s, pid) => [R('mc', P(s, pid).prod.heat)],
    policyText: 'Action: pay 10 M€ for +1 energy and +1 heat production.',
    policyAction: { text: 'Pay 10 M€: +1 energy and +1 heat production', cost: 10, once: false, ops: [{ k: 'prod', r: 'energy', n: 1 }, { k: 'prod', r: 'heat', n: 1 }] },
  },
};
export const partyName = (id: PartyId) => PARTY_DEFS[id].name;

// ---------------- global events ----------------
export interface EventDef {
  id: string;
  name: string;
  text: string;
  /** party that gets a neutral delegate when the event is revealed (distant), and when it becomes current */
  revealed: PartyId;
  current: PartyId;
  /** needs any of these expansions */
  needs?: ('venus' | 'colonies')[];
  negative?: boolean;
  /** effect per player, given influence; `first` true for the generation's first player */
  each?: (s: GameState, pid: number, inf: number, first: boolean) => Op[];
  /** effect over the whole table (rankings) */
  all?: (s: GameState, inf: (pid: number) => number) => { pid: number; ops: Op[] }[];
}

const capped = (n: number) => Math.min(5, n);
const lose = (n: number): Op[] => (n > 0 ? [R('mc', -n)] : []);
const gainMC = (n: number): Op[] => (n > 0 ? [R('mc', n)] : []);
const blueCards = (s: GameState, pid: number) => P(s, pid).played.filter((id) => CARDS[id].type === 'active').length;
const tilesByOcean = (s: GameState, pid: number) => marsTiles(s, pid).filter((x) => neighbours(s.board, x.id).some((n) => n.tile?.kind === 'ocean')).length;
const anyStd = (n: number): Op[] => Array.from({ length: n }, (): Op => ({
  k: 'choose', title: 'Take one standard resource', options: (['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]).map((r) => ({ label: `1 ${r === 'mc' ? 'M€' : r}`, ok: true, ops: [R(r, 1)] })),
}));
/** Most and second most (ties friendly: everyone tied for first gets first, and then nobody second). */
function rank(s: GameState, val: (pid: number) => number, min = 0): { first: number[]; second: number[] } {
  const v = s.players.map((p) => ({ pid: p.id, v: val(p.id) })).filter((x) => x.v >= min);
  if (!v.length) return { first: [], second: [] };
  const top = Math.max(...v.map((x) => x.v));
  const first = v.filter((x) => x.v === top).map((x) => x.pid);
  if (first.length > 1 || s.players.length < 2) return { first, second: [] };
  const rest = v.filter((x) => x.v !== top);
  if (!rest.length) return { first, second: [] };
  const sec = Math.max(...rest.map((x) => x.v));
  return { first, second: rest.filter((x) => x.v === sec).map((x) => x.pid) };
}

export const EVENTS: EventDef[] = [
  // ---- positive ----
  { id: 'sponsored-projects', name: 'Sponsored Projects', revealed: 'scientists', current: 'greens', text: 'Every card with resources on it gains 1. Draw a card per influence.',
    each: (s, pid, inf) => [...resCards(s, pid).filter((c) => (P(s, pid).cardRes[c] ?? 0) > 0).map((c): Op => ({ k: 'addRes', n: 1, target: 'this', card: c })), ...(inf ? [{ k: 'draw', n: inf } as Op] : [])] },
  { id: 'asteroid-mining', name: 'Asteroid Mining', revealed: 'reds', current: 'unity', text: '1 titanium per Jovian tag (at most 5), plus 1 per influence.',
    each: (s, pid, inf) => [R('titanium', capped(tagCount(s, pid, 'jovian')) + inf)] },
  { id: 'generous-funding', name: 'Generous Funding', revealed: 'kelvinists', current: 'unity', text: '2 M€ per influence and per 5 TR above 15 (at most 5 sets).',
    each: (s, pid, inf) => gainMC(2 * (inf + capped(Math.max(0, Math.floor((P(s, pid).tr - 15) / 5))))) },
  { id: 'successful-organisms', name: 'Successful Organisms', revealed: 'mars', current: 'scientists', text: '1 plant per plant production (at most 5), plus 1 per influence.',
    each: (s, pid, inf) => [R('plants', capped(P(s, pid).prod.plants) + inf)] },
  { id: 'productivity', name: 'Productivity', revealed: 'scientists', current: 'mars', text: '1 steel per steel production (at most 5), plus 1 per influence.',
    each: (s, pid, inf) => [R('steel', capped(P(s, pid).prod.steel) + inf)] },
  { id: 'homeworld-support', name: 'Homeworld Support', revealed: 'reds', current: 'unity', text: '2 M€ per Earth tag (at most 5) and per influence.',
    each: (s, pid, inf) => gainMC(2 * (capped(tagCount(s, pid, 'earth')) + inf)) },
  { id: 'volcanic-eruptions', name: 'Volcanic Eruptions', revealed: 'scientists', current: 'kelvinists', text: 'Temperature rises 2 steps (no TR). +1 heat production per influence.',
    each: (s, pid, inf, first) => [...(first ? [{ k: 'temp', n: 2, wgt: true } as Op] : []), ...(inf ? [{ k: 'prod', r: 'heat', n: inf } as Op] : [])] },
  { id: 'diversity', name: 'Diversity', revealed: 'scientists', current: 'scientists', text: '10 M€ if you have 9 different tags; influence counts as extra kinds.',
    each: (s, pid, inf) => (TAGS.filter((t) => t !== 'event' && t !== 'wild' && tagCount(s, pid, t) > 0).length + inf >= 9 ? [R('mc', 10)] : []) },
  { id: 'improved-energy-templates', name: 'Improved Energy Templates', revealed: 'scientists', current: 'kelvinists', text: '+1 energy production per 2 power tags; influence counts as power tags.',
    each: (s, pid, inf) => { const n = Math.floor((tagCount(s, pid, 'power') + inf) / 2); return n ? [{ k: 'prod', r: 'energy', n }] : []; } },
  { id: 'interplanetary-trade', name: 'Interplanetary Trade', revealed: 'unity', current: 'unity', text: '2 M€ per space tag (at most 5) and per influence.',
    each: (s, pid, inf) => gainMC(2 * (capped(tagCount(s, pid, 'space')) + inf)) },
  { id: 'celebrity-leaders', name: 'Celebrity Leaders', revealed: 'unity', current: 'greens', text: '2 M€ per event played (at most 5) and per influence.',
    each: (s, pid, inf) => gainMC(2 * (capped(eventsPlayed(s, pid)) + inf)) },
  { id: 'spinoff-products', name: 'Spin-off Products', revealed: 'greens', current: 'scientists', text: '2 M€ per science tag (at most 5) and per influence.',
    each: (s, pid, inf) => gainMC(2 * (capped(tagCount(s, pid, 'science')) + inf)) },
  { id: 'election', name: 'Election', revealed: 'greens', current: 'mars', text: 'Influence + building tags + city tiles: most gains 2 TR, second most 1 TR.',
    all: (s, inf) => { const r = rank(s, (pid) => inf(pid) + tagCount(s, pid, 'building') + s.board.filter((x) => x.tile?.kind === 'city' && x.tile.owner === pid).length);
      return [...r.first.map((pid) => ({ pid, ops: [{ k: 'tr', n: 2 } as Op] })), ...r.second.map((pid) => ({ pid, ops: [{ k: 'tr', n: 1 } as Op] }))]; } },
  { id: 'aquifer-released', name: 'Aquifer Released by Public Council', revealed: 'mars', current: 'greens', text: 'The first player places an ocean (no TR). 1 plant and 1 steel per influence.',
    each: (s, pid, inf, first) => [...(first ? [{ k: 'ocean', wgt: true } as Op] : []), ...(inf ? [R('plants', inf), R('steel', inf)] : [])] },
  { id: 'scientific-community', name: 'Scientific Community', revealed: 'reds', current: 'scientists', text: '1 M€ per card in hand, plus 1 per influence.',
    each: (s, pid, inf) => gainMC(P(s, pid).hand.length + inf) },
  { id: 'strong-society', name: 'Strong Society', revealed: 'reds', current: 'mars', text: '2 M€ per city tile (at most 5) and per influence.',
    each: (s, pid, inf) => gainMC(2 * (capped(cities(s, { pid }).length) + inf)) },
  // ---- negative ----
  { id: 'global-dust-storm', name: 'Global Dust Storm', revealed: 'kelvinists', current: 'greens', negative: true, text: 'Lose all heat. Lose 2 M€ per building tag (at most 5, less 1 per influence).',
    each: (s, pid, inf) => [R('heat', -P(s, pid).res.heat), ...lose(2 * Math.max(0, capped(tagCount(s, pid, 'building')) - inf))] },
  { id: 'eco-sabotage', name: 'Eco Sabotage', revealed: 'greens', current: 'reds', negative: true, text: 'Lose all plants except 3, plus 1 more kept per influence.',
    each: (s, pid, inf) => { const n = P(s, pid).res.plants - 3 - inf; return n > 0 ? [R('plants', -n)] : []; } },
  { id: 'miners-on-strike', name: 'Miners on Strike', revealed: 'mars', current: 'greens', negative: true, text: 'Lose 1 titanium per Jovian tag (at most 5, less 1 per influence).',
    each: (s, pid, inf) => { const n = Math.max(0, capped(tagCount(s, pid, 'jovian')) - inf); return n ? [R('titanium', -n)] : []; } },
  { id: 'mud-slides', name: 'Mud Slides', revealed: 'kelvinists', current: 'greens', negative: true, text: 'Lose 4 M€ per tile next to an ocean (at most 5, less 1 per influence).',
    each: (s, pid, inf) => lose(4 * Math.max(0, capped(tilesByOcean(s, pid)) - inf)) },
  { id: 'revolution', name: 'Revolution', revealed: 'unity', current: 'mars', negative: true, text: 'Earth tags + influence: most (at least 1) loses 2 TR, second most loses 1 TR.',
    all: (s, inf) => { const r = rank(s, (pid) => tagCount(s, pid, 'earth') + inf(pid), 1);
      return [...r.first.map((pid) => ({ pid, ops: [{ k: 'tr', n: -2 } as Op] })), ...r.second.map((pid) => ({ pid, ops: [{ k: 'tr', n: -1 } as Op] }))]; } },
  { id: 'riots', name: 'Riots', revealed: 'mars', current: 'reds', negative: true, text: 'Lose 4 M€ per city tile (at most 5, less 1 per influence).',
    each: (s, pid, inf) => lose(4 * Math.max(0, capped(cities(s, { pid }).length) - inf)) },
  { id: 'sabotage', name: 'Sabotage', revealed: 'unity', current: 'reds', negative: true, text: '−1 steel and −1 energy production. 1 steel per influence.',
    each: (s, pid, inf) => [{ k: 'prod', r: 'steel', n: -1 }, { k: 'prod', r: 'energy', n: -1 }, ...(inf ? [R('steel', inf)] : [])] },
  { id: 'snow-cover', name: 'Snow Cover', revealed: 'kelvinists', current: 'kelvinists', negative: true, text: 'Temperature drops 2 steps (TR stays). Draw a card per influence.',
    each: (s, pid, inf, first) => [...(first ? [{ k: 'lowerTemp', n: 2 } as Op] : []), ...(inf ? [{ k: 'draw', n: inf } as Op] : [])] },
  { id: 'pandemic', name: 'Pandemic', revealed: 'greens', current: 'mars', negative: true, text: 'Lose 3 M€ per building tag (at most 5, less 1 per influence).',
    each: (s, pid, inf) => lose(3 * Math.max(0, capped(tagCount(s, pid, 'building')) - inf)) },
  { id: 'war-on-earth', name: 'War on Earth', revealed: 'mars', current: 'kelvinists', negative: true, text: 'Lose 4 TR, 1 less per influence.',
    each: (s, pid, inf) => { const n = Math.max(0, 4 - inf); return n ? [{ k: 'tr', n: -n }] : []; } },
  { id: 'paradigm-breakdown', name: 'Paradigm Breakdown', revealed: 'kelvinists', current: 'reds', negative: true, text: 'Discard 2 cards. Gain 2 M€ per influence.',
    each: (s, pid, inf) => [...(P(s, pid).hand.length ? [{ k: 'discard', n: Math.min(2, P(s, pid).hand.length) } as Op] : []), ...gainMC(2 * inf)] },
  { id: 'dry-deserts', name: 'Dry Deserts', revealed: 'reds', current: 'unity', negative: true, text: 'The first player removes an ocean tile. 1 standard resource of your choice per influence.',
    each: (s, pid, inf, first) => [...(first ? [{ k: 'removeOcean' } as Op] : []), ...anyStd(inf)] },
  { id: 'red-influence', name: 'Red Influence', revealed: 'kelvinists', current: 'reds', negative: true, text: 'Lose 3 M€ per 5 TR above 10 (at most 5 sets). +1 M€ production per influence.',
    each: (s, pid, inf) => [...lose(3 * capped(Math.max(0, Math.floor((P(s, pid).tr - 10) / 5)))), ...(inf ? [{ k: 'prod', r: 'mc', n: inf } as Op] : [])] },
  { id: 'solarnet-shutdown', name: 'Solarnet Shutdown', revealed: 'scientists', current: 'mars', negative: true, text: 'Lose 3 M€ per blue card (at most 5, less 1 per influence).',
    each: (s, pid, inf) => lose(3 * Math.max(0, capped(blueCards(s, pid)) - inf)) },
  { id: 'solar-flare', name: 'Solar Flare', revealed: 'unity', current: 'kelvinists', negative: true, text: 'Lose 3 M€ per space tag (at most 5, less 1 per influence).',
    each: (s, pid, inf) => lose(3 * Math.max(0, capped(tagCount(s, pid, 'space')) - inf)) },
  // ---- with Colonies / Venus ----
  { id: 'jovian-tax-rights', name: 'Jovian Tax Rights', revealed: 'scientists', current: 'unity', needs: ['colonies'], text: '+1 M€ production per colony. 1 titanium per influence.',
    each: (s, pid, inf) => [...(colonyCount(s, pid) ? [{ k: 'prod', r: 'mc', n: colonyCount(s, pid) } as Op] : []), ...(inf ? [R('titanium', inf)] : [])] },
  { id: 'microgravity-health-problems', name: 'Microgravity Health Problems', revealed: 'mars', current: 'scientists', needs: ['colonies'], negative: true, text: 'Lose 3 M€ per colony (at most 5, less 1 per influence).',
    each: (s, pid, inf) => lose(3 * Math.max(0, capped(colonyCount(s, pid)) - inf)) },
  { id: 'cloud-societies', name: 'Cloud Societies', revealed: 'unity', current: 'reds', needs: ['venus', 'colonies'], text: 'Add a floater to every card that collects floaters. Add 1 floater per influence to a card.',
    each: (s, pid, inf) => [...resCards(s, pid, 'floater').map((c): Op => ({ k: 'addRes', n: 1, target: 'this', card: c })), ...(inf ? [{ k: 'addRes', n: inf, rtype: 'floater', target: 'any' } as Op] : [])] },
  { id: 'corrosive-rain', name: 'Corrosive Rain', revealed: 'kelvinists', current: 'greens', needs: ['venus', 'colonies'], negative: true, text: 'Lose 2 floaters from a card, or 10 M€. Draw a card per influence.',
    each: (s, pid, inf) => [{ k: 'choose', title: 'Corrosive Rain', options: [
      { label: 'Lose 2 floaters from a card', ok: resCards(s, pid, 'floater').some((c) => (P(s, pid).cardRes[c] ?? 0) >= 2), ops: [{ k: 'spendRes', n: 2, rtype: 'floater' }] },
      { label: 'Lose 10 M€', ok: true, ops: [R('mc', -10)] },
    ] }, ...(inf ? [{ k: 'draw', n: inf } as Op] : [])] },
  { id: 'venus-infrastructure', name: 'Venus Infrastructure', revealed: 'mars', current: 'unity', needs: ['venus'], text: '2 M€ per Venus tag (at most 5) and per influence.',
    each: (s, pid, inf) => gainMC(2 * (capped(tagCount(s, pid, 'venus')) + inf)) },
];
const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
export const eventDef = (id: string) => EVENT_BY_ID.get(id)!;

// ---------------- state helpers ----------------
export const T = (s: GameState): TurmoilState => s.turmoil!;
const emptyParty = (): PartyState => ({ delegates: [], leader: null });

export function newTurmoil(s: GameState): TurmoilState {
  const ex = s.options.expansions ?? {};
  const pool = EVENTS.filter((e) => !e.needs || e.needs.some((n) => ex[n])).map((e) => e.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(s) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const t: TurmoilState = {
    parties: Object.fromEntries(PARTIES.map((p) => [p, emptyParty()])) as Record<PartyId, PartyState>,
    ruling: 'greens', dominant: 'greens', chairman: NEUTRAL,
    reserve: s.players.map(() => DELEGATES_PER_PLAYER), neutral: NEUTRAL_DELEGATES - 1,
    lobbyUsed: [], deck: pool, discard: [], current: null, coming: null, distant: null,
  };
  return t;
}

const count = (ps: PartyState, who: number) => ps.delegates.filter((d) => d === who).length;

/** Reserve left for a player (or neutral). */
export const reserveOf = (s: GameState, who: number) => (who === NEUTRAL ? T(s).neutral : T(s).reserve[who]);

/** Sends a delegate from the reserve; the party leader changes when someone has more delegates there. */
export function sendDelegate(s: GameState, who: number, party: PartyId): boolean {
  const t = T(s);
  if (reserveOf(s, who) <= 0) return false;
  if (who === NEUTRAL) t.neutral--; else t.reserve[who]--;
  const ps = t.parties[party];
  ps.delegates.push(who);
  if (ps.leader === null || (ps.leader !== who && count(ps, who) > count(ps, ps.leader))) ps.leader = who;
  checkDominant(s);
  return true;
}

export function removeDelegate(s: GameState, who: number, party: PartyId) {
  const t = T(s);
  const ps = t.parties[party];
  const i = ps.delegates.lastIndexOf(who);
  if (i < 0) return;
  ps.delegates.splice(i, 1);
  if (who === NEUTRAL) t.neutral++; else t.reserve[who]++;
  if (ps.leader === who && count(ps, who) === 0) {
    // the delegate with most others there takes over
    let best: number | null = null;
    for (const d of ps.delegates) if (best === null || count(ps, d) > count(ps, best)) best = d;
    ps.leader = best;
  }
  checkDominant(s);
}

const size = (s: GameState, p: PartyId) => T(s).parties[p].delegates.length;

/** Keeps the dominant party if it still has the most delegates; otherwise the next one with most, going round from it. */
export function checkDominant(s: GameState) {
  const t = T(s);
  const max = Math.max(...PARTIES.map((p) => size(s, p)));
  if (size(s, t.dominant) !== max) t.dominant = nextDominant(s, t.dominant);
}
export function nextDominant(s: GameState, from: PartyId): PartyId {
  const max = Math.max(...PARTIES.map((p) => size(s, p)));
  const i = PARTIES.indexOf(from);
  const order = [...PARTIES.slice(i + 1), ...PARTIES.slice(0, i)].reverse();
  return order.find((p) => size(s, p) === max) ?? from;
}

/** Influence for global events: chairman, leader of the dominant party, another delegate there, cards. */
export function influence(s: GameState, pid: number): number {
  const t = T(s);
  let n = 0;
  if (t.chairman === pid) n++;
  const dom = t.parties[t.dominant];
  if (dom.leader === pid) n++;
  if (count(dom, pid) > (dom.leader === pid ? 1 : 0)) n++;
  const p = P(s, pid);
  for (const id of p.corp ? [p.corp, ...p.played] : p.played) n += CARDS[id].influence ?? 0;
  return n;
}

/** "Requires that X is ruling or that you have 2 delegates there." */
export const partyOk = (s: GameState, pid: number, party: PartyId) => !!s.turmoil && (T(s).ruling === party || count(T(s).parties[party], pid) >= 2);
export const leaders = (s: GameState, pid: number) => (s.turmoil ? Object.values(T(s).parties).filter((ps) => ps.leader === pid).length : 0);
export const isChairman = (s: GameState, pid: number) => !!s.turmoil && T(s).chairman === pid;
export const ruling = (s: GameState): PartyId | null => s.turmoil?.ruling ?? null;
export const delegatesIn = (s: GameState, pid: number, party: PartyId) => (s.turmoil ? count(T(s).parties[party], pid) : 0);
/** Delegates a player has out of the reserve (party leaders and the chairman count). */
export const delegatesOut = (s: GameState, pid: number) => (s.turmoil ? DELEGATES_PER_PLAYER - T(s).reserve[pid] : 0);
export const lobbyFree = (s: GameState, pid: number) => !!s.turmoil && !T(s).lobbyUsed.includes(pid);
export const delegateCost = (s: GameState, pid: number) => (lobbyFree(s, pid) ? 0 : DELEGATE_COST);

/** Whether the Reds tax TR raised in actions. */
export const redsRuling = (s: GameState) => s.turmoil?.ruling === 'reds';

void ownedTiles; void allTags;
