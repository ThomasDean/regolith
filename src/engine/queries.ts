// Read-only rules queries: costs, payment, requirements, legal placements, milestones,
// awards and scoring.
import type { CardDef } from './cards';
import type { GameState, Op, PayLimits, Payment, Placement, Res, StdProject, Tag, TileKind } from './types';
import { CARDS } from './cards';
import { neighbours, GANYMEDE, PHOBOS, onMars, maxOceans, maxOxy, maxTemp } from './board';
import { awardDef, gameAwards, gameMilestones, milestoneDef, MILESTONE_COST } from './ma';
import { cities, greeneries, ownedTiles, P, tagCount } from './helpers';

export const steelValue = (s: GameState, pid: number) => 2 + (P(s, pid).played.includes('advanced-alloys') ? 1 : 0);
export const titaniumValue = (s: GameState, pid: number) =>
  3 + (P(s, pid).played.includes('advanced-alloys') ? 1 : 0) + (P(s, pid).corp === 'phobolog' ? 1 : 0);
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

export function requirementsMet(s: GameState, pid: number, id: string): boolean {
  const r = CARDS[id].req;
  if (!r) return true;
  const b = reqBonus(s, pid);
  if (r.temp !== undefined && s.temperature < r.temp - 2 * b) return false;
  if (r.tempMax !== undefined && s.temperature > r.tempMax + 2 * b) return false;
  if (r.oxy !== undefined && s.oxygen < r.oxy - b) return false;
  if (r.oxyMax !== undefined && s.oxygen > r.oxyMax + b) return false;
  if (r.oceans !== undefined && s.oceans < r.oceans - b) return false;
  if (r.oceansMax !== undefined && s.oceans > r.oceansMax + b) return false;
  if (r.tags) {
    for (const [t, n] of Object.entries(r.tags)) {
      if (tagCount(s, pid, t as Tag) < (n ?? 0)) return false;
    }
  }
  if (r.prod) {
    for (const [k, n] of Object.entries(r.prod)) if (P(s, pid).prod[k as Res] < (n ?? 0)) return false;
  }
  if (r.greeneries !== undefined && greeneries(s, pid).length < r.greeneries) return false;
  if (r.citiesAll !== undefined && cities(s).length < r.citiesAll) return false;
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
  if (r.tempMax !== undefined && s.temperature > r.tempMax + 2 * b) dead = true;
  if (r.oxyMax !== undefined && s.oxygen > r.oxyMax + b) dead = true;
  if (r.oceansMax !== undefined && s.oceans > r.oceansMax + b) dead = true;
  if (r.tags) for (const [t, n] of Object.entries(r.tags)) steps = Math.max(steps, ((n ?? 0) - tagCount(s, pid, t as Tag)) * 3);
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
  let out: GameState['board'];
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
  }
  return true;
}

export function payLimitsForCard(s: GameState, pid: number, id: string): PayLimits {
  const c = CARDS[id];
  return { steel: c.tags.includes('building'), titanium: c.tags.includes('space'), heat: P(s, pid).corp === 'helion' };
}

/** Returns the M€ part of a payment, or null if the payment is invalid (or overpays needlessly). */
export function checkPayment(s: GameState, pid: number, cost: number, pay: Payment, lim: PayLimits): number | null {
  const p = P(s, pid);
  const st = pay.steel ?? 0, ti = pay.titanium ?? 0, he = pay.heat ?? 0;
  if (st < 0 || ti < 0 || he < 0) return null;
  if ((st && !lim.steel) || (ti && !lim.titanium) || (he && !lim.heat)) return null;
  if (st > p.res.steel || ti > p.res.titanium || he > p.res.heat) return null;
  const sv = steelValue(s, pid), tv = titaniumValue(s, pid);
  const covered = st * sv + ti * tv + he;
  if (covered > cost && ((st && covered - sv >= cost) || (ti && covered - tv >= cost) || (he && covered - 1 >= cost))) return null;
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
  return p.res.mc + (lim.steel ? p.res.steel * steelValue(s, pid) : 0) + (lim.titanium ? p.res.titanium * titaniumValue(s, pid) : 0) + (lim.heat ? p.res.heat : 0);
}

export function canPlayCard(s: GameState, pid: number, id: string): boolean {
  const p = P(s, pid);
  if (!p.hand.includes(id)) return false;
  const c = CARDS[id];
  if (!requirementsMet(s, pid, id)) return false;
  if (c.canPlay && !c.canPlay(s, pid)) return false;
  if (c.play && !opsFeasible(s, pid, c.play(s, pid, id))) return false;
  return maxSpend(s, pid, payLimitsForCard(s, pid, id)) >= cardCost(s, pid, id);
}

export const SP_COST: Record<StdProject, number> = { sell: 0, power: 11, asteroid: 14, aquifer: 18, greenery: 23, city: 25 };
export const SP_NAME: Record<StdProject, string> = { sell: 'Sell patents', power: 'Power plant', asteroid: 'Asteroid', aquifer: 'Aquifer', greenery: 'Greenery', city: 'City' };
export const spCost = (s: GameState, pid: number, id: StdProject) => (id === 'power' && P(s, pid).corp === 'thorgate' ? 8 : SP_COST[id]);

export function canSP(s: GameState, pid: number, id: StdProject): boolean {
  const p = P(s, pid);
  if (id === 'sell') return p.hand.length > 0;
  if (id === 'asteroid' && s.temperature >= maxTemp(s)) return false;
  if (id === 'aquifer' && s.oceans >= maxOceans(s)) return false;
  if (id === 'greenery' && availableSpaces(s, pid, 'greenery', 'greenery').length === 0) return false;
  if (id === 'city' && availableSpaces(s, pid, 'city', 'city').length === 0) return false;
  return p.res.mc + (p.corp === 'helion' ? p.res.heat : 0) >= spCost(s, pid, id);
}

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
