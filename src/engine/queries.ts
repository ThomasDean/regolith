// Read-only rules queries: costs, payment, requirements, legal placements, milestones,
// awards and scoring.
import type { CardDef } from './cards';
import type { GameState, Op, PayLimits, Payment, Placement, Res, StdProject, Tag, TileKind } from './types';
import { CARDS } from './cards';
import { neighbours, GANYMEDE, PHOBOS, OFF_SPACES, onMars, maxOceans, maxOxy, maxTemp, MAX_VENUS } from './board';
import { awardDef, gameAwards, gameMilestones, milestoneDef, MILESTONE_COST } from './ma';
import { cities, greeneries, inPlay, ownedTiles, P, resCards, resOnCards, tagCount } from './helpers';
import { buildableTiles, colonyCount, fleetsFree, tradeTargets } from './colonies';
import { T, isChairman, leaders, partyOk, redsRuling } from './turmoil';

export const has = (s: Pick<GameState, 'options'>, e: 'prelude' | 'venus' | 'colonies' | 'turmoil') => !!s.options.expansions?.[e];

export const steelValue = (s: GameState, pid: number) => 2 + (P(s, pid).played.includes('advanced-alloys') ? 1 : 0);
export const titaniumValue = (s: GameState, pid: number) =>
  3 + (P(s, pid).played.includes('advanced-alloys') ? 1 : 0) + (P(s, pid).corp === 'phobolog' ? 1 : 0) + (s.turmoil?.ruling === 'unity' ? 1 : 0);
/** M€ to buy a card into hand (research, Business Network…): Polyphemos 5, TerraLabs 1. */
export const buyCost = (s: GameState, pid: number) => (P(s, pid).corp === 'polyphemos' ? 5 : P(s, pid).corp === 'terralabs-research' ? 1 : 3);
/** Reds' tax on TR raised in an action: 3 M€ per step. */
export const redsTax = (s: GameState, steps: number) => (redsRuling(s) ? 3 * Math.max(0, steps) : 0);
export const venusOf = (s: GameState) => s.venus ?? 0;
export const greeneryCost = (s: GameState, pid: number) => (P(s, pid).corp === 'ecoline' ? 7 : 8);

/** Corporation and non-event cards in play: the ones with ongoing effects. */
export function activeCards(s: GameState, pid: number): CardDef[] {
  const p = P(s, pid);
  const ids = p.corp ? [p.corp, ...p.played] : p.played;
  return ids.map((id) => CARDS[id]).filter((c) => c.type !== 'event');
}

export function cardCost(s: GameState, pid: number, id: string): number {
  const c = CARDS[id];
  let cost = c.cost;
  for (const a of activeCards(s, pid)) {
    if (!a.discount) continue;
    if (!a.discount.tag || c.tags.includes(a.discount.tag)) cost -= a.discount.n;
  }
  cost -= P(s, pid).nextCardDiscount;
  return Math.max(0, cost);
}

export function reqBonus(s: GameState, pid: number): number {
  let b = P(s, pid).reqBonusNext;
  for (const a of activeCards(s, pid)) b += a.reqBonus ?? 0;
  return b;
}
/** Venus requirements get Morning Star's ±2 on top. */
export const venusReqBonus = (s: GameState, pid: number) => reqBonus(s, pid) + (P(s, pid).corp === 'morning-star-inc' ? 2 : 0);

/** Tags still missing for a card's tag requirements, after wild tags fill in. */
export function tagShortfall(s: GameState, pid: number, tags: Partial<Record<Tag, number>>): number {
  let short = 0;
  for (const [t, n] of Object.entries(tags)) short += Math.max(0, (n ?? 0) - tagCount(s, pid, t as Tag));
  return Math.max(0, short - tagCount(s, pid, 'wild'));
}

/** Whether a card's requirements are met; `ignoreGlobal` skips temperature/oxygen/ocean/Venus (Ecology Experts). */
export function requirementsMet(s: GameState, pid: number, id: string, ignoreGlobal = false): boolean {
  const r = CARDS[id].req;
  if (!r) return true;
  const b = reqBonus(s, pid);
  const vb = venusReqBonus(s, pid);
  const v = venusOf(s);
  if (!ignoreGlobal) {
    if (r.temp !== undefined && s.temperature < r.temp - 2 * b) return false;
    if (r.tempMax !== undefined && s.temperature > r.tempMax + 2 * b) return false;
    if (r.oxy !== undefined && s.oxygen < r.oxy - b) return false;
    if (r.oxyMax !== undefined && s.oxygen > r.oxyMax + b) return false;
    if (r.oceans !== undefined && s.oceans < r.oceans - b) return false;
    if (r.oceansMax !== undefined && s.oceans > r.oceansMax + b) return false;
    if (r.venus !== undefined && v < r.venus - 2 * vb) return false;
    if (r.venusMax !== undefined && v > r.venusMax + 2 * vb) return false;
  }
  if (r.tags && tagShortfall(s, pid, r.tags) > 0) return false;
  if (r.prod) {
    for (const [k, n] of Object.entries(r.prod)) if (P(s, pid).prod[k as Res] < (n ?? 0)) return false;
  }
  if (r.greeneries !== undefined && greeneries(s, pid).length < r.greeneries) return false;
  if (r.citiesAll !== undefined && cities(s).length < r.citiesAll) return false;
  if (r.cities !== undefined && cities(s, { pid }).length < r.cities) return false;
  if (r.floaters !== undefined && resOnCards(s, pid, 'floater') < r.floaters) return false;
  if (r.tr !== undefined && P(s, pid).tr < r.tr) return false;
  if (r.colonies !== undefined && colonyCount(s, pid) < r.colonies) return false;
  if (r.coloniesMax !== undefined && colonyCount(s, pid) > r.coloniesMax) return false;
  if (r.party !== undefined && !partyOk(s, pid, r.party)) return false;
  if (r.chairman && !isChairman(s, pid)) return false;
  if (r.leaders !== undefined && leaders(s, pid) < r.leaders) return false;
  return true;
}

/** How far a card is from being playable: global steps still needed, or dead if a max is passed. */
export function requirementGap(s: GameState, pid: number, id: string): { steps: number; dead: boolean } {
  const r = CARDS[id].req;
  if (!r) return { steps: 0, dead: false };
  const b = reqBonus(s, pid);
  let steps = 0, dead = false;
  if (r.temp !== undefined) steps = Math.max(steps, Math.ceil((r.temp - 2 * b - s.temperature) / 2));
  if (r.oxy !== undefined) steps = Math.max(steps, r.oxy - b - s.oxygen);
  if (r.oceans !== undefined) steps = Math.max(steps, r.oceans - b - s.oceans);
  const vb = venusReqBonus(s, pid);
  // Venus is slower to move than the Mars tracks (no game end pushes it)
  if (r.venus !== undefined) steps = Math.max(steps, Math.ceil((r.venus - 2 * vb - venusOf(s)) / 2) * 1.5);
  if (r.tempMax !== undefined && s.temperature > r.tempMax + 2 * b) dead = true;
  if (r.oxyMax !== undefined && s.oxygen > r.oxyMax + b) dead = true;
  if (r.oceansMax !== undefined && s.oceans > r.oceansMax + b) dead = true;
  if (r.venusMax !== undefined && venusOf(s) > r.venusMax + 2 * vb) dead = true;
  if (r.coloniesMax !== undefined && colonyCount(s, pid) > r.coloniesMax) dead = true;
  if (r.tags) {
    // the largest single gap, as before wild tags existed; with wild tags, what they can't cover
    const wild = tagCount(s, pid, 'wild');
    const gaps = Object.entries(r.tags).map(([t, n]) => Math.max(0, (n ?? 0) - tagCount(s, pid, t as Tag)));
    steps = Math.max(steps, (wild ? tagShortfall(s, pid, r.tags) : Math.max(0, ...gaps)) * 3);
  }
  if (r.tr !== undefined && P(s, pid).tr < r.tr) steps = Math.max(steps, r.tr - P(s, pid).tr);
  if (r.floaters !== undefined && resOnCards(s, pid, 'floater') < r.floaters) steps = Math.max(steps, (r.floaters - resOnCards(s, pid, 'floater')) * 1.5);
  if (r.colonies !== undefined && colonyCount(s, pid) < r.colonies) steps = Math.max(steps, 3);
  if (r.cities !== undefined && cities(s, { pid }).length < r.cities) steps = Math.max(steps, 3);
  if (r.party !== undefined && !partyOk(s, pid, r.party)) steps = Math.max(steps, 3);
  if ((r.chairman && !isChairman(s, pid)) || (r.leaders !== undefined && leaders(s, pid) < r.leaders)) steps = Math.max(steps, 4);
  if (r.prod) {
    for (const [k, n] of Object.entries(r.prod)) if (P(s, pid).prod[k as Res] < (n ?? 0)) steps = Math.max(steps, 3);
  }
  if (r.greeneries !== undefined && greeneries(s, pid).length < r.greeneries) steps = Math.max(steps, 2);
  if (r.citiesAll !== undefined && cities(s).length < r.citiesAll) steps = Math.max(steps, 2);
  return { steps: Math.max(0, steps), dead };
}

const empty = (x: GameState['board'][number], pid: number) => !x.tile && (x.claimedBy === undefined || x.claimedBy === pid);
const isCity = (x: GameState['board'][number]) => x.tile?.kind === 'city';

export function availableSpaces(s: GameState, pid: number, rule: Placement, kind: TileKind): string[] {
  const p = P(s, pid);
  // spaces that charge M€ (Hellas south pole, Vastitas north pole) need the money while their bonus still applies
  const affordable = (x: GameState['board'][number]) => !x.cost || !spaceCostApplies(s, x) || p.res.mc >= x.cost;
  const land = s.board.filter((x) => x.type === 'land' && empty(x, pid) && !x.reserved && affordable(x));
  const nextToCity = (x: GameState['board'][number]) => neighbours(s.board, x.id).some(isCity);
  const noNeighbours = (x: GameState['board'][number]) => neighbours(s.board, x.id).every((n) => !n.tile);
  const nextToOwn = (x: GameState['board'][number]) => neighbours(s.board, x.id).some((n) => n.tile && n.tile.owner === pid);
  const mineral = (x: GameState['board'][number]) => x.bonus.includes('steel') || x.bonus.includes('titanium');
  const hasVolcanoes = s.board.some((x) => x.volcanic);
  const hasNoctis = s.board.some((x) => x.reserved);
  let out: GameState['board'] = [];
  switch (rule) {
    case 'ocean': out = s.board.filter((x) => x.type === 'ocean' && empty(x, pid)); break;
    case 'oceanArea': out = s.board.filter((x) => x.type === 'ocean' && empty(x, pid)); break;
    case 'land': out = land; break;
    case 'city': out = land.filter((x) => !nextToCity(x)); break;
    case 'cityIsolated': out = land.filter(noNeighbours); break;
    case 'isolated': out = land.filter(noNeighbours); break;
    case 'adj2Cities': out = land.filter((x) => neighbours(s.board, x.id).filter(isCity).length >= 2); break;
    case 'adjCity': out = land.filter(nextToCity); break;
    case 'adjGreenery': out = land.filter((x) => neighbours(s.board, x.id).some((n) => n.tile?.kind === 'greenery')); break;
    // maps without volcanoes let Lava Flows go on any land
    case 'volcanic': out = hasVolcanoes ? land.filter((x) => x.volcanic) : land; break;
    // maps without a Noctis region place Noctis City like any other city
    case 'noctis': out = hasNoctis ? s.board.filter((x) => x.reserved && empty(x, pid)) : land.filter((x) => !nextToCity(x)); break;
    case 'ganymede': out = s.board.filter((x) => x.id === GANYMEDE && !x.tile); break;
    case 'phobos': out = s.board.filter((x) => x.id === PHOBOS && !x.tile); break;
    case 'dawnCity': case 'lunaMetropolis': case 'maxwellBase': case 'stratopolis':
      out = s.board.filter((x) => x.id === OFF_SPACES[rule] && !x.tile); break;
    // Lava Tube Settlement: a volcanic area, ignoring nearby cities
    case 'volcanicCity': out = hasVolcanoes ? land.filter((x) => x.volcanic) : land; break;
    case 'miningRights': out = land.filter(mineral); break;
    case 'miningArea': out = land.filter((x) => mineral(x) && nextToOwn(x)); break;
    case 'claim': out = s.board.filter((x) => x.type !== 'off' && !x.tile && x.claimedBy === undefined); break;
    case 'greenery': {
      const adj = land.filter(nextToOwn);
      out = adj.length ? adj : land;
      break;
    }
  }
  if (kind === 'ocean' && s.oceans >= maxOceans(s)) return [];
  return out.map((x) => x.id);
}

/** Whether a space's M€ cost is still charged: only while its ocean or temperature bonus does something. */
export function spaceCostApplies(s: GameState, x: GameState['board'][number]): boolean {
  if (!x.cost) return false;
  if (x.bonus.includes('ocean')) return s.oceans < maxOceans(s);
  if (x.bonus.includes('temp')) return s.temperature < maxTemp(s);
  return true;
}

/** Whether a list of ops can be carried out in full (production floors, stock, tile space…). */
export function opsFeasible(s: GameState, pid: number, ops: Op[]): boolean {
  const p = P(s, pid);
  const prod = { ...p.prod };
  const stock = { ...p.res };
  for (const o of ops) {
    if (o.k === 'prod' && o.n < 0) {
      prod[o.r] += o.n;
      if (o.r === 'mc' ? prod.mc < -5 : prod[o.r] < 0) return false;
    }
    if (o.k === 'res' && o.n < 0) {
      stock[o.r] += o.n;
      if (stock[o.r] < 0) return false;
    }
    if (o.k === 'tile' && o.tile !== 'ocean' && availableSpaces(s, pid, o.rule, o.tile).length === 0) return false;
    if (o.k === 'decProd' && !s.players.some((q) => (o.r === 'mc' ? q.prod.mc - o.n >= -5 : q.prod[o.r] >= o.n))) return false;
    if (o.k === 'choose' && !o.options.some((x) => x.ok)) return false;
    if (o.k === 'colony' && !buildableTiles(s, pid, o.dup).length) return false;
    if (o.k === 'pay') {
      stock.mc -= Math.max(0, o.n - (o.titanium ? stock.titanium * titaniumValue(s, pid) : 0) - (o.steel ? stock.steel * steelValue(s, pid) : 0));
      if (stock.mc < 0) return false;
    }
    if (o.k === 'spendRes' && !resCards(s, pid, o.rtype).some((c) => (p.cardRes[c] ?? 0) >= o.n)) return false;
    if (o.k === 'delegate' && (!s.turmoil || T(s).reserve[pid] < (o.one ? o.n : 1))) return false;
    if (o.k === 'trade' && (fleetsFree(s, pid) <= 0 || !tradeTargets(s).length)) return false;
  }
  return true;
}

/** TR steps a list of ops would raise for its player (for the Reds' tax). */
export function trSteps(s: GameState, ops: Op[]): number {
  let n = 0;
  for (const o of ops) {
    if (o.k === 'tr' && o.n > 0) n += o.n;
    else if (o.k === 'temp' && !o.wgt) n += Math.min(o.n, Math.max(0, (maxTemp(s) - s.temperature) / 2));
    else if (o.k === 'oxy' && !o.wgt) n += Math.min(o.n, Math.max(0, maxOxy(s) - s.oxygen));
    else if (o.k === 'venus' && !o.wgt) n += Math.min(o.n, Math.max(0, (MAX_VENUS - venusOf(s)) / 2));
    else if ((o.k === 'ocean' && !o.wgt) || (o.k === 'tile' && o.tile === 'ocean' && !o.wgt)) n += s.oceans < maxOceans(s) ? 1 : 0;
    else if (o.k === 'tile' && o.tile === 'greenery') n += s.oxygen < maxOxy(s) ? 1 : 0;
    else if (o.k === 'choose') {
      // the cheapest way through the choice
      const ok = o.options.filter((x) => x.ok).map((x) => trSteps(s, x.ops));
      if (ok.length) n += Math.min(...ok);
    }
  }
  return n;
}

export function payLimitsForCard(s: GameState, pid: number, id: string): PayLimits {
  const c = CARDS[id];
  return {
    steel: c.tags.includes('building'), titanium: c.tags.includes('space'), heat: P(s, pid).corp === 'helion',
    floaters: c.tags.includes('venus') && inPlay(s, pid, 'dirigibles'), microbes: c.tags.includes('plant') && inPlay(s, pid, 'psychrophiles'),
  };
}
/** Floaters on Dirigibles and microbes on Psychrophiles, the only resources that pay for cards. */
export const payStock = (s: GameState, pid: number, k: 'floaters' | 'microbes') => P(s, pid).cardRes[k === 'floaters' ? 'dirigibles' : 'psychrophiles'] ?? 0;
const FLOATER_VALUE = 3, MICROBE_VALUE = 2;

/** Returns the M€ part of a payment, or null if the payment is invalid (or overpays needlessly). */
export function checkPayment(s: GameState, pid: number, cost: number, pay: Payment, lim: PayLimits): number | null {
  const p = P(s, pid);
  const st = pay.steel ?? 0, ti = pay.titanium ?? 0, he = pay.heat ?? 0, fl = pay.floaters ?? 0, mi = pay.microbes ?? 0;
  if (st < 0 || ti < 0 || he < 0 || fl < 0 || mi < 0) return null;
  if ((st && !lim.steel) || (ti && !lim.titanium) || (he && !lim.heat) || (fl && !lim.floaters) || (mi && !lim.microbes)) return null;
  if (st > p.res.steel || ti > p.res.titanium || he > p.res.heat || fl > payStock(s, pid, 'floaters') || mi > payStock(s, pid, 'microbes')) return null;
  const sv = steelValue(s, pid), tv = titaniumValue(s, pid);
  const covered = st * sv + ti * tv + he + fl * FLOATER_VALUE + mi * MICROBE_VALUE;
  if (covered > cost && ((st && covered - sv >= cost) || (ti && covered - tv >= cost) || (he && covered - 1 >= cost) || (fl && covered - FLOATER_VALUE >= cost) || (mi && covered - MICROBE_VALUE >= cost))) return null;
  const mc = Math.max(0, cost - covered);
  if (mc > p.res.mc) return null;
  return mc;
}

/** Default payment: titanium, then steel, then M€, then heat for Helion. */
export function autoPay(s: GameState, pid: number, cost: number, lim: PayLimits): Payment | null {
  const p = P(s, pid);
  const sv = steelValue(s, pid), tv = titaniumValue(s, pid);
  let left = cost;
  const pay: Payment = {};
  if (lim.titanium && p.res.titanium) {
    const n = Math.min(p.res.titanium, Math.floor(left / tv));
    if (n) { pay.titanium = n; left -= n * tv; }
  }
  if (lim.steel && p.res.steel) {
    const n = Math.min(p.res.steel, Math.floor(left / sv));
    if (n) { pay.steel = n; left -= n * sv; }
  }
  // card resources only when M€ falls short (they may be worth more where they are)
  for (const [k, v] of [['floaters', FLOATER_VALUE], ['microbes', MICROBE_VALUE]] as const) {
    if (!lim[k] || left <= p.res.mc) continue;
    const n = Math.min(payStock(s, pid, k), Math.ceil((left - p.res.mc) / v), Math.floor(left / v));
    if (n > 0) { pay[k] = n; left -= n * v; }
  }
  if (left > p.res.mc) {
    if (lim.steel && (pay.steel ?? 0) < p.res.steel && left - sv <= p.res.mc && left < sv * 2) {
      pay.steel = (pay.steel ?? 0) + 1;
      left = Math.max(0, left - sv);
    } else if (lim.titanium && (pay.titanium ?? 0) < p.res.titanium && left - tv <= p.res.mc && left < tv * 2) {
      pay.titanium = (pay.titanium ?? 0) + 1;
      left = Math.max(0, left - tv);
    }
  }
  if (left > p.res.mc && lim.heat) {
    const h = Math.min(p.res.heat, left - p.res.mc);
    pay.heat = h;
    left -= h;
  }
  if (left > p.res.mc) return null;
  return checkPayment(s, pid, cost, pay, lim) === null ? null : pay;
}

export function maxSpend(s: GameState, pid: number, lim: PayLimits): number {
  const p = P(s, pid);
  return p.res.mc + (lim.steel ? p.res.steel * steelValue(s, pid) : 0) + (lim.titanium ? p.res.titanium * titaniumValue(s, pid) : 0) + (lim.heat ? p.res.heat : 0)
    + (lim.floaters ? payStock(s, pid, 'floaters') * FLOATER_VALUE : 0) + (lim.microbes ? payStock(s, pid, 'microbes') * MICROBE_VALUE : 0);
}

export interface PlayMods { discount?: number; ignoreReq?: boolean }

export function canPlayCard(s: GameState, pid: number, id: string, mods: PlayMods = {}): boolean {
  const p = P(s, pid);
  if (!p.hand.includes(id)) return false;
  const c = CARDS[id];
  if (!requirementsMet(s, pid, id, mods.ignoreReq)) return false;
  if (c.canPlay && !c.canPlay(s, pid)) return false;
  const ops = c.play ? c.play(s, pid, id) : [];
  if (c.play && !opsFeasible(s, pid, ops)) return false;
  const cost = Math.max(0, cardCost(s, pid, id) - (mods.discount ?? 0));
  if (maxSpend(s, pid, payLimitsForCard(s, pid, id)) < cost) return false;
  // the Reds' tax is paid in M€ on top
  const tax = redsTax(s, trSteps(s, ops));
  return !tax || P(s, pid).res.mc >= tax + Math.max(0, cost - (maxSpend(s, pid, payLimitsForCard(s, pid, id)) - P(s, pid).res.mc));
}

export const SP_COST: Record<StdProject, number> = { sell: 0, power: 11, asteroid: 14, aquifer: 18, greenery: 23, city: 25, venus: 15, colony: 17 };
export const SP_NAME: Record<StdProject, string> = { sell: 'Sell patents', power: 'Power plant', asteroid: 'Asteroid', aquifer: 'Aquifer', greenery: 'Greenery', city: 'City', venus: 'Air scrapping', colony: 'Build colony' };
export const spCost = (s: GameState, pid: number, id: StdProject) => (id === 'power' && P(s, pid).corp === 'thorgate' ? 8 : SP_COST[id]);
/** TR a standard project raises (for the Reds' tax). */
const SP_TR: Partial<Record<StdProject, number>> = { asteroid: 1, aquifer: 1, greenery: 1, venus: 1 };

export function canSP(s: GameState, pid: number, id: StdProject): boolean {
  const p = P(s, pid);
  if (id === 'sell') return p.hand.length > 0;
  if (id === 'asteroid' && s.temperature >= maxTemp(s)) return false;
  if (id === 'aquifer' && s.oceans >= maxOceans(s)) return false;
  if (id === 'greenery' && availableSpaces(s, pid, 'greenery', 'greenery').length === 0) return false;
  if (id === 'city' && availableSpaces(s, pid, 'city', 'city').length === 0) return false;
  if (id === 'venus' && (!has(s, 'venus') || venusOf(s) >= MAX_VENUS)) return false;
  if (id === 'colony' && (!has(s, 'colonies') || !buildableTiles(s, pid).length)) return false;
  const greenTR = id === 'greenery' ? (s.oxygen < maxOxy(s) ? 1 : 0) : SP_TR[id] ?? 0;
  return p.res.mc + (p.corp === 'helion' ? p.res.heat : 0) >= spCost(s, pid, id) + redsTax(s, greenTR);
}
/** Standard projects offered in this game. */
export const spList = (s: GameState): StdProject[] =>
  ['power', 'asteroid', 'aquifer', 'greenery', 'city', ...(has(s, 'venus') ? ['venus' as const] : []), ...(has(s, 'colonies') ? ['colony' as const] : [])];

export { MILESTONE_COST };
export { MILESTONES, AWARDS, gameMilestones, gameAwards, milestoneDef, awardDef } from './ma';
export type { Milestone, Award } from './ma';
export const awardCost = (s: GameState) => [8, 14, 20][s.awards.length] ?? Infinity;
const canPayMC = (s: GameState, pid: number, n: number) => P(s, pid).res.mc + (P(s, pid).corp === 'helion' ? P(s, pid).res.heat : 0) >= n;

export function canClaimMilestone(s: GameState, pid: number, id: string): boolean {
  if (s.milestones.length >= 3 || s.milestones.some((m) => m.id === id)) return false;
  if (!gameMilestones(s).some((m) => m.id === id)) return false;
  const m = milestoneDef(id);
  return m.metric(s, pid) >= m.need && canPayMC(s, pid, MILESTONE_COST);
}

export function canFundAward(s: GameState, pid: number, id: string): boolean {
  if (s.awards.length >= 3 || s.awards.some((a) => a.id === id)) return false;
  if (!gameAwards(s).some((a) => a.id === id)) return false;
  return canPayMC(s, pid, awardCost(s));
}

/** First and second place for an award. No second place with two players or a tie for first. */
export function awardPlaces(s: GameState, id: string): { first: number[]; second: number[] } {
  const a = awardDef(id);
  const vals = s.players.map((p) => ({ pid: p.id, v: a.metric(s, p.id) }));
  const top = Math.max(...vals.map((v) => v.v));
  const first = vals.filter((v) => v.v === top).map((v) => v.pid);
  if (first.length > 1 || s.players.length < 3) return { first, second: [] };
  const rest = vals.filter((v) => v.v !== top);
  const sec = Math.max(...rest.map((v) => v.v));
  return { first, second: rest.filter((v) => v.v === sec).map((v) => v.pid) };
}

export function cardVP(s: GameState, pid: number, id: string): number {
  const c = CARDS[id];
  if (c.vp === undefined) return 0;
  return typeof c.vp === 'number' ? c.vp : c.vp(s, pid, id);
}

export interface Score { tr: number; milestones: number; awards: number; greeneries: number; cities: number; cards: number; total: number }

export function score(s: GameState, pid: number): Score {
  const p = P(s, pid);
  const milestones = s.milestones.filter((m) => m.pid === pid).length * 5;
  let awards = 0;
  for (const a of s.awards) {
    const pl = awardPlaces(s, a.id);
    if (pl.first.includes(pid)) awards += 5;
    else if (pl.second.includes(pid)) awards += 2;
  }
  const gr = greeneries(s, pid).filter(onMars).length;
  let ci = 0;
  for (const c of cities(s, { pid })) ci += neighbours(s.board, c.id).filter((n) => n.tile?.kind === 'greenery').length;
  let cards = 0;
  for (const id of [p.corp, ...p.played]) if (id) cards += cardVP(s, pid, id);
  const total = p.tr + milestones + awards + gr + ci + cards;
  return { tr: p.tr, milestones, awards, greeneries: gr, cities: ci, cards, total };
}

export const parametersMaxed = (s: GameState) => s.temperature >= maxTemp(s) && s.oxygen >= maxOxy(s) && s.oceans >= maxOceans(s);
export const stepsLeft = (s: GameState) => (maxTemp(s) - s.temperature) / 2 + (maxOxy(s) - s.oxygen) + (maxOceans(s) - s.oceans);

export function cardActionAvailable(s: GameState, pid: number, id: string): boolean {
  const p = P(s, pid);
  const c = CARDS[id];
  if (!c.action || p.usedActions.includes(id)) return false;
  if (id !== p.corp && !p.played.includes(id)) return false;
  if (!c.action.can(s, pid, id)) return false;
  if (!opsFeasible(s, pid, c.action.run(s, pid, id))) return false;
  if (c.action.mc) {
    const lim = { steel: !!c.action.steel, titanium: !!c.action.titanium, heat: false };
    if (maxSpend(s, pid, lim) < c.action.mc) return false;
  }
  return true;
}

export const tilesOwned = ownedTiles;
export type { PayLimits };
