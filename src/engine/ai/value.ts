// Engine-aware valuation for CPU players. Everything is expressed in M€-equivalents for one
// player, and depends on how many generations are likely left: production and card draw are
// worth a lot early, victory points dominate late.
import type { CardRes, GameState, Op, Res, Tag } from '../types';
import { MAX_OCEANS, MAX_OXY, MAX_TEMP, TAGS } from '../types';
import { CARDS, PROJECT_IDS, type CardDef } from '../cards';
import { P, cities, greeneries, tagCount } from '../helpers';
import { neighbours } from '../board';
import {
  activeCards, AWARDS, awardPlaces, cardCost, greeneryCost, MILESTONES, payLimitsForCard, requirementGap,
  requirementsMet, score, stepsLeft, steelValue, titaniumValue,
} from '../queries';

export interface Weights {
  lambda: number; // how much opponents' gains count against ours
  synergy: boolean; // value tags by how they feed the engine
  tempo: boolean; // speed up or slow down the game depending on who is ahead
}

// ---------------- horizon ----------------
/** Expected generations left, counting the current one. */
export function horizon(s: GameState): number {
  const left = stepsLeft(s);
  if (left <= 0) return 1;
  const n = s.players.length;
  const base = 2.2 + n * 0.9; // typical steps per generation by player count
  const done = 42 - left;
  const observed = s.generation > 1 ? done / (s.generation - 1) : 0;
  // terraforming accelerates as engines come online
  const pace = Math.max(base, observed * 1.15, 2);
  // real games rarely run past generation 14, so the clock also tightens with time
  const cap = Math.max(1, 15 - s.generation);
  return Math.max(1, Math.min(cap, Math.ceil(left / pace)));
}

export interface Ctx {
  s: GameState;
  pid: number;
  G: number; // generations left including this one
  last: boolean; // the game very likely ends this generation
  vp: number; // M€ value of 1 VP
  w: Weights;
  mcv?: number; // cached M€ value
  drawv?: number; // cached card-draw value
  /** valuing a card for later: resource targets still in hand count (at a discount) */
  future?: boolean;
}

/** Horizon is fixed when a decision starts, so outcomes are compared on the same clock. */
export interface Clock { G: number; last: boolean }
export function clockOf(s: GameState): Clock {
  const G = horizon(s);
  return { G, last: G <= 1 && stepsLeft(s) <= Math.max(3, s.players.length * 2.5) };
}

export function makeCtx(s: GameState, pid: number, w: Weights, clock: Clock = clockOf(s)): Ctx {
  const { G, last } = clock;
  return { s, pid, G, last, vp: 5 + 5 * (1 - Math.min(G, 10) / 10), w };
}

// ---------------- static pool statistics ----------------
const TAG_FREQ: Record<Tag, number> = Object.fromEntries(TAGS.map((t) => [t, 0])) as Record<Tag, number>;
const EVENT_FREQ = { all: 0, space: 0 };
{
  for (const id of PROJECT_IDS) {
    const c = CARDS[id];
    for (const t of new Set(c.tags)) TAG_FREQ[t] += 1 / PROJECT_IDS.length;
    if (c.type === 'event') {
      EVENT_FREQ.all += 1 / PROJECT_IDS.length;
      if (c.tags.includes('space')) EVENT_FREQ.space += 1 / PROJECT_IDS.length;
    }
  }
}
/** Cards this player is likely to play for the rest of the game (excluding the hand). */
const futurePlays = (c: Ctx) => Math.max(0, (c.G - 1) * 2.5 + 1);
const handWithTag = (c: Ctx, t: Tag) => P(c.s, c.pid).hand.filter((id) => CARDS[id].tags.includes(t)).length;
const expectedTagPlays = (c: Ctx, t: Tag) => handWithTag(c, t) * 0.7 + futurePlays(c) * TAG_FREQ[t];

// ---------------- unit values ----------------
const tempLeft = (s: GameState) => Math.max(0, (MAX_TEMP - s.temperature) / 2);
const oxyLeft = (s: GameState) => Math.max(0, MAX_OXY - s.oxygen);
const oceansLeft = (s: GameState) => Math.max(0, MAX_OCEANS - s.oceans);

export const trValue = (c: Ctx) => c.vp + (c.last ? 0 : c.G - 0.5);
export const cardDrawValue = (c: Ctx) => {
  if (c.last) return 0.3;
  if (c.drawv === undefined) {
    const base = Math.max(1, Math.min(4, 1 + c.G * 0.45));
    c.drawv = base; // provisional, breaks the cycle through hand valuation
    c.drawv = base * (handOverBudget(c) ? 0.35 : 1);
  }
  return c.drawv;
};

function raiseValue(c: Ctx, param: 'temp' | 'oxy' | 'ocean'): number {
  let v = trValue(c);
  if (c.w.tempo) {
    // ahead: closing the game out is worth more; behind: every raise hastens a loss
    const lead = leadMargin(c);
    v += Math.max(-3, Math.min(3, lead * 0.25));
  }
  if (param === 'ocean') v += 2.5; // placement bonus + adjacency M€ on average
  return v;
}

export function leadMargin(c: Ctx): number {
  const mine = score(c.s, c.pid).total;
  const best = Math.max(...c.s.players.filter((p) => p.id !== c.pid).map((p) => score(c.s, p.id).total));
  return mine - best;
}

function usesSteel(c: Ctx) {
  const p = P(c.s, c.pid);
  const b = p.hand.filter((id) => CARDS[id].tags.includes('building')).length;
  const sink = (id: string) => (p.played.includes(id) ? 0.4 : c.w.synergy && p.hand.includes(id) ? 0.2 : 0);
  return Math.min(1, 0.45 + b * 0.15 + Math.max(sink('space-elevator'), sink('electro-catapult')));
}
function usesTitanium(c: Ctx) {
  const p = P(c.s, c.pid);
  const b = p.hand.filter((id) => CARDS[id].tags.includes('space')).length;
  const fleet = p.played.includes('security-fleet') ? 0.3 : c.w.synergy && p.hand.includes('security-fleet') ? 0.15 : 0;
  return Math.min(1, 0.45 + b * 0.15 + fleet);
}

export function greeneryValue(c: Ctx): number {
  const oxy = oxyLeft(c.s) > 0 && !c.last ? raiseValue(c, 'oxy') : 0;
  return c.vp + oxy + 1.5;
}

/**
 * What 1 M€ is worth. Early on it buys engine; late it's only as good as the terraforming or
 * greeneries it can buy, slightly discounted so the CPU spends rather than hoards.
 */
export function mcValue(c: Ctx): number {
  if (c.last) return 0.15;
  if (c.mcv !== undefined) return c.mcv;
  const invest = Math.min(1, 0.25 + 0.15 * c.G);
  const s = c.s;
  let conv = greeneryValue(c) / 23;
  if (tempLeft(s) > 0) conv = Math.max(conv, raiseValue(c, 'temp') / 14);
  if (oceansLeft(s) > 0) conv = Math.max(conv, raiseValue(c, 'ocean') / 18);
  c.mcv = Math.max(invest, conv * 0.92);
  return c.mcv;
}

export function resValue(c: Ctx, r: Res): number {
  const s = c.s, p = P(s, c.pid);
  switch (r) {
    case 'mc': return mcValue(c);
    case 'steel': return c.last ? 0.3 : steelValue(s, c.pid) * usesSteel(c);
    case 'titanium': return c.last ? 0.4 : titaniumValue(s, c.pid) * usesTitanium(c);
    case 'plants': {
      const g = greeneryValue(c) / greeneryCost(s, c.pid);
      // plants are exposed to attacks; protected ones keep their value
      // stockpiled plants are exposed to attacks and only pay off once converted
      return g * (p.played.includes('protected-habitats') ? 0.8 : 0.65);
    }
    case 'heat': {
      const helion = p.corp === 'helion' ? resValue(c, 'mc') : 0;
      const temp = tempLeft(s) > 0 ? raiseValue(c, 'temp') / 8 : 0;
      const caretaker = p.played.includes('caretaker-contract') ? trValue(c) / 8
        : c.w.synergy && p.hand.includes('caretaker-contract') ? trValue(c) / 8 * 0.5 : 0;
      return Math.max(helion, temp * 0.6, caretaker * 0.8);
    }
    case 'energy': {
      const needs = energyDemand(c);
      return needs > 0 ? Math.max(resValue(c, 'heat'), 1.3) : resValue(c, 'heat');
    }
  }
}

const ENERGY_SINKS: Record<string, number> = {
  ironworks: 4, steelworks: 4, 'ore-processor': 4, 'physics-complex': 6, 'water-splitting-plant': 3,
  'development-center': 1, 'martian-rails': 1, 'power-infrastructure': 2,
};

/** Energy per generation the player's actions can turn into value (sinks in hand count half). */
function energyDemand(c: Ctx): number {
  const p = P(c.s, c.pid);
  let n = 0;
  for (const id of p.played) n += ENERGY_SINKS[id] ?? 0;
  if (c.w.synergy) for (const id of p.hand) n += (ENERGY_SINKS[id] ?? 0) * 0.5;
  return n;
}

export function prodValue(c: Ctx, r: Res): number {
  if (c.last) return r === 'mc' ? 0 : 0;
  const gens = c.G - 0.3; // production this generation happens soon; later ones are less certain
  let unit = resValue(c, r);
  if (r === 'energy') {
    const demand = energyDemand(c);
    const have = P(c.s, c.pid).prod.energy;
    unit = have < demand ? 1.6 : resValue(c, 'heat');
  }
  if (r === 'heat') unit = Math.min(unit, tempLeft(c.s) > c.G * 1.2 ? unit : unit * (tempLeft(c.s) / (c.G * 1.2 + 0.1)));
  return unit * gens * 0.92;
}

// ---------------- card resources ----------------
const RES_PER_VP: Record<string, number> = {
  ants: 2, birds: 1, decomposers: 3, 'ecological-zone': 2, fish: 1, herbivores: 2, livestock: 1, pets: 2, predators: 1,
  'small-animals': 2, tardigrades: 4, 'security-fleet': 1, 'physics-complex': 0.5,
};
export function resUnitValue(c: Ctx, id: string): number {
  const per = RES_PER_VP[id];
  let v = per ? c.vp / per : 0;
  if (id === 'nitrite-reducing-bacteria') v = Math.max(v, trValue(c) / 3);
  if (id === 'ghg-producing-bacteria' && tempLeft(c.s) > 0) v = Math.max(v, raiseValue(c, 'temp') / 2);
  if (id === 'regolith-eaters' && oxyLeft(c.s) > 0) v = Math.max(v, raiseValue(c, 'oxy') / 2);
  if (id === 'olympus-conference') v = Math.max(v, cardDrawValue(c));
  if (id === 'search-for-life') v = (P(c.s, c.pid).cardRes[id] ?? 0) > 0 ? 0 : 3 * c.vp;
  return v;
}

function bestResTarget(c: Ctx, rtype: CardRes | undefined, exclude?: string): number {
  const p = P(c.s, c.pid);
  let best = 0;
  for (const id of p.played) {
    if (id === exclude) continue;
    if (rtype ? CARDS[id].resource !== rtype : !(p.cardRes[id] > 0)) continue;
    best = Math.max(best, resUnitValue(c, id));
  }
  // planning ahead: a target we still hold will usually be in play before the resources arrive
  if (c.future && c.w.synergy && rtype) {
    for (const id of p.hand) {
      if (id === exclude || CARDS[id].resource !== rtype) continue;
      best = Math.max(best, resUnitValue(c, id) * 0.5);
    }
  }
  return best;
}

/** Resources other cards will push onto a new accumulator: feeder actions per generation, one-off feeds. */
const FEED_ACTIONS: Record<string, { rtype: CardRes; n: number }> = {
  'symbiotic-fungus': { rtype: 'microbe', n: 1 },
  'extreme-cold-fungus': { rtype: 'microbe', n: 2 },
};
const FEED_ONCE: Record<string, { rtype: CardRes; n: number }[]> = {
  'large-convoy': [{ rtype: 'animal', n: 4 }],
  'imported-hydrogen': [{ rtype: 'microbe', n: 3 }, { rtype: 'animal', n: 2 }],
  'imported-nitrogen': [{ rtype: 'microbe', n: 3 }, { rtype: 'animal', n: 2 }],
  'aerobraked-ammonia-asteroid': [{ rtype: 'microbe', n: 2 }],
  'eos-chasma-national-park': [{ rtype: 'animal', n: 1 }],
  'local-heat-trapping': [{ rtype: 'animal', n: 2 }],
};

/**
 * Extra worth of a not-yet-played accumulator because feeders will fill it: feeders in play
 * count fully (their own value is already in play), feeders still in hand count half (the
 * feeder's hand value counts the other half).
 */
function feedBonus(c: Ctx, id: string): number {
  if (!c.w.synergy) return 0;
  const card = CARDS[id];
  const rtype = card.resource;
  if (rtype !== 'microbe' && rtype !== 'animal') return 0;
  const unit = resUnitValue(c, id);
  if (unit <= 0) return 0;
  const p = P(c.s, c.pid);
  const gain = Math.max(0, unit - bestResTarget({ ...c, future: false }, rtype, id));
  if (gain <= 0) return 0;
  const gens = Math.max(0, c.G - 1);
  let v = 0;
  for (const [f, d] of Object.entries(FEED_ACTIONS)) {
    if (d.rtype !== rtype || f === id) continue;
    if (p.played.includes(f)) v += d.n * gain * gens * 0.75;
    else if (p.hand.includes(f)) v += d.n * gain * gens * 0.75 * 0.5;
  }
  for (const f of p.hand) {
    for (const d of FEED_ONCE[f] ?? []) if (d.rtype === rtype) v += d.n * gain * 0.5;
  }
  return v;
}

// ---------------- op values ----------------
export function opValue(c: Ctx, op: Op, src?: string): number {
  const s = c.s;
  switch (op.k) {
    case 'res': return op.n * resValue(c, op.r);
    case 'prod': return op.n * prodValue(c, op.r);
    case 'tr': return op.n * trValue(c);
    case 'temp': {
      const n = Math.min(op.n, tempLeft(s));
      let v = n * raiseValue(c, 'temp');
      for (let i = 1; i <= n; i++) {
        const t = s.temperature + 2 * i;
        if (t === -24 || t === -20) v += prodValue(c, 'heat');
        if (t === 0 && oceansLeft(s) > 0) v += raiseValue(c, 'ocean');
      }
      return v;
    }
    case 'oxy': {
      const n = Math.min(op.n, oxyLeft(s));
      let v = n * raiseValue(c, 'oxy');
      if (s.oxygen < 8 && s.oxygen + n >= 8 && tempLeft(s) > 0) v += raiseValue(c, 'temp');
      return v;
    }
    case 'ocean': return oceansLeft(s) > 0 ? raiseValue(c, 'ocean') : 0;
    case 'tile': {
      if (op.tile === 'ocean') return oceansLeft(s) > 0 ? raiseValue(c, 'ocean') : 0;
      if (op.tile === 'greenery') return greeneryValue(c);
      if (op.tile === 'city') {
        const adj = c.last ? 0.5 : Math.min(2.5, 0.6 + c.G * 0.25);
        let v = adj * c.vp + 1.5;
        if (op.card === 'capital') v += 1.5 * c.vp;
        const mayor = mayorValue(c);
        return v + mayor;
      }
      if (op.rule === 'claim') return 1;
      if (op.card === 'commercial-district') return 1.5 * c.vp;
      if (op.rule === 'miningRights' || op.rule === 'miningArea') return prodValue(c, 'steel') * 0.8 + 1.5;
      return 1.5;
    }
    case 'removeAny': {
      const victims = s.players.filter((q) => q.id !== c.pid && q.res[op.r] > 0);
      if (!victims.length) return 0;
      const most = Math.max(...victims.map((q) => Math.min(op.n, q.res[op.r])));
      return c.w.lambda * most * resValue(c, op.r);
    }
    case 'steal': {
      const most = Math.max(0, ...s.players.filter((q) => q.id !== c.pid).map((q) => Math.min(op.n, q.res[op.r])));
      return most * resValue(c, op.r) * (1 + c.w.lambda);
    }
    case 'decProd': {
      const opp = s.players.some((q) => q.id !== c.pid && (op.r === 'mc' ? q.prod.mc - op.n >= -5 : q.prod[op.r] >= op.n));
      const hit = opp ? c.w.lambda * op.n * prodValue(c, op.r) : -op.n * prodValue(c, op.r);
      return hit + (op.gain ? op.n * prodValue(c, op.r) : 0);
    }
    case 'addRes': {
      if (op.target === 'this') return op.n * resUnitValue(c, op.card ?? src ?? '');
      if (op.target === 'anyWithRes') return bestResTarget(c, undefined) * op.n;
      return op.n * bestResTarget(c, op.rtype, op.target === 'other' ? src : undefined);
    }
    case 'removeCardRes': return op.gainTo ? resUnitValue(c, op.gainTo) * op.n + c.w.lambda * c.vp * 0.5 : c.w.lambda * c.vp * op.n * 0.5;
    case 'draw': return op.n * cardDrawValue(c);
    case 'look': return op.buy ? Math.max(0, cardDrawValue(c) * 1.3 - 3 + 0.5) : op.keep * cardDrawValue(c) * 1.15;
    case 'choose': {
      // when planning ahead, an option that needs a target we still hold becomes available later
      const usable = (o: (typeof op.options)[number]) => o.ok || (!!c.future && c.w.synergy && o.ops.every((x) => x.k === 'addRes'));
      return Math.max(0, ...op.options.filter(usable).map((o) => o.ops.reduce((a, x) => a + opValue(c, x, src), 0)));
    }
    case 'discardDraw': return cardDrawValue(c) * 0.3;
    case 'amount':
      if (op.id === 'insulation') return Math.max(0, op.max * (prodValue(c, 'mc') - prodValue(c, 'heat')));
      return op.max * Math.max(0, resValue(c, 'mc') - resValue(c, 'energy'));
    case 'robotic': return 0; // valued in cardValue
    case 'searchLife': return 0.11 * resUnitValue(c, op.card) - 1;
    case 'log': return 0;
  }
}

function mayorValue(c: Ctx): number {
  if (c.s.milestones.length >= 3 || c.s.milestones.some((m) => m.id === 'mayor')) return 0;
  const have = cities(c.s, { pid: c.pid }).length;
  return have < 3 ? (5 * c.vp) / (3 - have) / 3 : 0;
}

// ---------------- passive effects ----------------
const SCALERS: Record<string, { tag: Tag; per: number; kind: 'mc' | 'plants' | 'energy' | 'tr' }> = {
  cartel: { tag: 'earth', per: 1, kind: 'mc' },
  satellites: { tag: 'space', per: 1, kind: 'mc' },
  'power-grid': { tag: 'power', per: 1, kind: 'energy' },
  insects: { tag: 'plant', per: 1, kind: 'plants' },
  'medical-lab': { tag: 'building', per: 2, kind: 'mc' },
  'miranda-resort': { tag: 'earth', per: 1, kind: 'mc' },
  worms: { tag: 'microbe', per: 2, kind: 'plants' },
  'terraforming-ganymede': { tag: 'jovian', per: 1, kind: 'tr' },
};
const JOVIAN_VP = ['io-mining-industries', 'ganymede-colony', 'water-import-from-europa'];

/** Future value of an active card's ongoing effect (discounts, triggers, protections). */
export function passiveValue(c: Ctx, id: string): number {
  const card = CARDS[id];
  const s = c.s, p = P(s, c.pid);
  let v = 0;
  if (card.discount) {
    const n = card.discount.tag ? expectedTagPlays(c, card.discount.tag) : P(s, c.pid).hand.length * 0.6 + futurePlays(c);
    v += card.discount.n * n;
  }
  if (card.reqBonus) v += 2 + p.hand.filter((h) => !requirementsMet(s, c.pid, h) && requirementGap(s, c.pid, h).steps <= 2).length * 3;
  const bio = (tags: Tag[]) => tags.reduce((a, t) => a + expectedTagPlays(c, t), 0);
  switch (id) {
    case 'decomposers': v += bio(['plant', 'animal', 'microbe']) * c.vp / 3; break;
    case 'ecological-zone': v += bio(['plant', 'animal']) * c.vp / 2; break;
    case 'viral-enhancers': v += bio(['plant', 'animal', 'microbe']) * resValue(c, 'plants') * 1.2; break;
    case 'mars-university': v += expectedTagPlays(c, 'science') * 1.2; break;
    case 'olympus-conference': v += expectedTagPlays(c, 'science') * cardDrawValue(c) * 0.5; break;
    case 'media-group': v += (futurePlays(c) * EVENT_FREQ.all + handEvents(c)) * 3; break;
    case 'interplanetary-cinematics': v += (futurePlays(c) * EVENT_FREQ.all + handEvents(c)) * 2; break;
    case 'optimal-aerobraking': v += (futurePlays(c) * EVENT_FREQ.space + handEvents(c, 'space')) * (3 + 3 * resValue(c, 'heat')); break;
    case 'credicor': v += (futurePlays(c) * 0.22 + c.G * 0.4) * 4; break;
    case 'standard-technology': v += c.G * 0.6 * 3; break;
    case 'saturn-systems': v += expectedTagPlays(c, 'jovian') * s.players.length * prodValue(c, 'mc') * 0.5; break;
    case 'arctic-algae': v += oceansLeft(s) * 2 * resValue(c, 'plants'); break;
    case 'pets': v += citiesToCome(c) * c.vp / 2; break;
    case 'rover-construction': v += citiesToCome(c) * 2; break;
    case 'immigrant-city': v += citiesToCome(c) * prodValue(c, 'mc') * 0.5; break;
    case 'tharsis-republic': v += citiesToCome(c) * prodValue(c, 'mc') * 0.5 + c.G * 0.3 * 3; break;
    case 'herbivores': v += Math.min(c.G, 4) * 0.5 * c.vp; break;
    case 'mining-guild': v += c.G * 0.3 * prodValue(c, 'steel') * 0.5; break;
    case 'protected-habitats': v += 2 + p.res.plants * 0.2; break;
    case 'advanced-alloys': v += (p.prod.steel * c.G + p.res.steel) * usesSteel(c) + (p.prod.titanium * c.G + p.res.titanium) * usesTitanium(c); break;
    case 'phobolog': v += (p.prod.titanium * c.G + p.res.titanium) * usesTitanium(c); break;
    case 'helion': v += Math.max(0, (p.prod.heat * c.G + p.res.heat) * (resValue(c, 'mc') - resValue(c, 'heat') * 0.8)) * 0.5; break;
    case 'ecoline': v += (p.prod.plants * c.G + p.res.plants) * (greeneryValue(c) / 7 - greeneryValue(c) / 8); break;
    case 'inventrix': break;
  }
  return v;
}
const handEvents = (c: Ctx, tag?: Tag) => P(c.s, c.pid).hand.filter((id) => CARDS[id].type === 'event' && (!tag || CARDS[id].tags.includes(tag))).length * 0.7;
const citiesToCome = (c: Ctx) => Math.max(0, (c.G - 1) * c.s.players.length * 0.45);

/** Value of the card's blue action over the rest of the game. */
export function actionFutureValue(c: Ctx, id: string, usedThisGen: boolean): number {
  const a = CARDS[id].action;
  if (!a) return 0;
  const s = c.s, p = P(s, c.pid);
  const fc: Ctx = { ...c, future: true };
  let per = a.run(s, c.pid, id).reduce((acc, op) => acc + opValue(fc, op, id), 0) - (a.mc ?? 0) * (a.steel || a.titanium ? 0.8 : 1) * resValue(c, 'mc');
  // energy-hungry actions are limited by energy production
  let uses = c.G - (usedThisGen ? 1 : 0);
  const energyCost: Record<string, number> = { ironworks: 4, steelworks: 4, 'ore-processor': 4, 'physics-complex': 6, 'water-splitting-plant': 3, 'development-center': 1, 'martian-rails': 1 };
  if (energyCost[id]) {
    uses = Math.min(uses, (p.prod.energy * c.G + p.res.energy) / energyCost[id]);
    per += energyCost[id] * resValue(c, 'energy') * 0; // energy is consumed; its alternative value is heat
    per -= energyCost[id] * resValue(c, 'heat') * 0.5;
  }
  if (id === 'equatorial-magnetizer') uses = Math.min(uses, p.prod.energy);
  if (id === 'caretaker-contract') uses = Math.min(uses, (p.prod.heat * c.G + p.res.heat) / 8);
  if (id === 'security-fleet') uses = Math.min(uses, p.prod.titanium * c.G + p.res.titanium);
  if (id === 'space-elevator') uses = Math.min(uses, p.prod.steel * c.G + p.res.steel);
  if (id === 'search-for-life') per = (p.cardRes[id] ?? 0) > 0 ? -1 : 0.11 * 3 * c.vp * (1 - 0.11) - 1;
  return Math.max(0, per) * Math.max(0, uses) * 0.85;
}

// ---------------- tags ----------------
/** How much one more tag of each kind is worth to this player's engine. */
export function tagValue(c: Ctx, t: Tag): number {
  if (!c.w.synergy || t === 'event') return 0;
  const s = c.s, p = P(s, c.pid);
  let v = 0;
  for (const h of p.hand) {
    const sc = SCALERS[h];
    if (sc && sc.tag === t) {
      const unit = sc.kind === 'tr' ? trValue(c) : prodValue(c, sc.kind);
      v += (unit / sc.per) * 0.6;
    }
    const need = CARDS[h].req?.tags?.[t];
    if (need) {
      const have = tagCount(s, c.pid, t);
      if (have < need) v += Math.max(0, cardCoreValue(c, h, false) - cardCost(s, c.pid, h)) * 0.5 / (need - have);
    }
  }
  if (t === 'jovian') {
    for (const id of JOVIAN_VP) {
      if (p.played.includes(id)) v += c.vp;
      else if (p.hand.includes(id)) v += c.vp * 0.5;
    }
    // Saturn Systems pays its owner whenever anyone plays a Jovian tag
    for (const q of s.players) if (q.id !== c.pid && q.corp === 'saturn-systems') v -= c.w.lambda * prodValue(c, 'mc');
  }
  for (const a of activeCards(s, c.pid)) {
    if (a.discount?.tag === t) v += 0; // discounts apply to the card itself, handled in cost
  }
  // milestone / award races
  if (t === 'building' && !s.milestones.some((m) => m.id === 'builder') && s.milestones.length < 3) {
    const have = tagCount(s, c.pid, 'building');
    if (have >= 4 && have < 8) v += (5 * c.vp) / (8 - have) * 0.4;
  }
  if (t === 'science' && s.awards.some((a) => a.id === 'scientist')) v += c.vp * 0.6;
  return v;
}

// ---------------- cards ----------------
/** Gross value of playing a card now (before cost), from the owner's point of view. */
export function cardCoreValue(c: Ctx, id: string, withTags = true): number {
  const card = CARDS[id];
  const s = c.s;
  let v = 0;
  if (card.play) {
    try {
      for (const op of card.play(s, c.pid, id)) v += opValue(c, op, id);
    } catch {
      /* cards with state-dependent play functions may throw on odd states */
    }
  }
  // scalers get one more of their own tag once played
  const sc = SCALERS[id];
  if (sc && card.tags.includes(sc.tag)) {
    const unit = sc.kind === 'tr' ? trValue(c) : prodValue(c, sc.kind);
    v += unit / sc.per * (sc.per === 1 ? 1 : 0.5);
  }
  if (id === 'robotic-workforce') {
    let best = 0;
    for (const t of P(s, c.pid).played) {
      const cd = CARDS[t];
      if (!cd.tags.includes('building') || !cd.play || cd.type === 'event') continue;
      try {
        best = Math.max(best, cd.play(s, c.pid, t).filter((o) => o.k === 'prod').reduce((a, o) => a + opValue(c, o, t), 0));
      } catch { /* ignore */ }
    }
    v += best;
  }
  // VP
  v += cardVPEstimate(c, id) * c.vp;
  v += actionFutureValue(c, id, false);
  v += passiveValue(c, id);
  v += feedBonus(c, id);
  // "when you play" effects from cards already in play, and opponents' reactions
  for (const q of s.players) {
    for (const a of activeCards(s, q.id)) {
      if (!a.onCard) continue;
      const ops = a.onCard(s, q.id, c.pid, card);
      const val = ops.reduce((acc, op) => acc + opValue(q.id === c.pid ? c : { ...c, pid: q.id }, op, a.id), 0);
      v += q.id === c.pid ? val : -c.w.lambda * val;
    }
  }
  if (withTags && card.type !== 'event') for (const t of card.tags) v += tagValue(c, t);
  // card triggers that include the card itself (Decomposers, Ecological Zone, Mars University...)
  if (card.onCard) {
    const ops = card.onCard(s, c.pid, c.pid, card);
    v += ops.reduce((acc, op) => acc + opValue(c, op, id), 0) * 0.8;
  }
  return v;
}

function cardVPEstimate(c: Ctx, id: string): number {
  const card = CARDS[id];
  if (card.vp === undefined) return 0;
  if (typeof card.vp === 'number') return card.vp;
  const p = P(c.s, c.pid);
  if (RES_PER_VP[id] && card.action) return 0; // covered by the action value
  if (id === 'pets' || id === 'decomposers' || id === 'ecological-zone' || id === 'herbivores') return 0.5; // passive value covers growth
  if (JOVIAN_VP.includes(id)) return tagCount(c.s, c.pid, 'jovian') + 1 + Math.min(2, expectedTagPlays(c, 'jovian'));
  if (id === 'immigration-shuttles') return (cities(c.s).length + citiesToCome(c)) / 3;
  if (id === 'capital') return 2;
  if (id === 'commercial-district') return 1.5;
  if (id === 'search-for-life') return 0;
  void p;
  return 0.5;
}

/** Effective cost of a card in M€-equivalents, valuing steel/titanium at what they're worth to us. */
export function cardEffectiveCost(c: Ctx, id: string): number {
  const s = c.s, p = P(s, c.pid);
  const cost = cardCost(s, c.pid, id);
  const lim = payLimitsForCard(s, c.pid, id);
  let left = cost, eff = 0;
  if (lim.titanium) {
    const tv = titaniumValue(s, c.pid);
    const n = Math.min(p.res.titanium, Math.floor(left / tv));
    left -= n * tv;
    eff += n * resValue(c, 'titanium');
  }
  if (lim.steel) {
    const sv = steelValue(s, c.pid);
    const n = Math.min(p.res.steel, Math.floor(left / sv));
    left -= n * sv;
    eff += n * resValue(c, 'steel');
  }
  return eff + left * resValue(c, 'mc');
}

/** Production steps we're missing to pay a card's own production decreases. */
export function productionShortfall(c: Ctx, id: string): number {
  const card = CARDS[id];
  if (!card.play) return 0;
  let ops: Op[];
  try { ops = card.play(c.s, c.pid, id); } catch { return 0; }
  const p = P(c.s, c.pid);
  const need: Partial<Record<Res, number>> = {};
  for (const o of ops) if (o.k === 'prod' && o.n < 0) need[o.r] = (need[o.r] ?? 0) - o.n;
  let short = 0;
  for (const [r, n] of Object.entries(need) as [Res, number][]) {
    short += r === 'mc' ? Math.max(0, n - (p.prod.mc + 5)) : Math.max(0, n - p.prod[r]);
  }
  return short;
}

/** Net value of holding a card: what playing it should yield, discounted by how long we'd wait. */
export function cardNetValue(c: Ctx, id: string): number {
  const gap = requirementGap(c.s, c.pid, id);
  if (gap.dead) return -2;
  const core = cardCoreValue(c, id);
  const cost = cardEffectiveCost(c, id);
  let net = core - cost;
  if (gap.steps > 0) {
    const pace = Math.max(2, stepsLeft(c.s) / Math.max(1, c.G));
    const wait = gap.steps / pace;
    if (wait >= c.G) return -1;
    net *= Math.max(0.15, 1 - wait / c.G) * 0.8;
  }
  // cards that cost production we don't have yet (energy for cities, etc.) must wait for it
  const short = productionShortfall(c, id);
  if (short > 0) net *= Math.pow(0.55, short);
  // cards with a max requirement may expire
  const r = CARDS[id].req;
  if (r && (r.tempMax !== undefined || r.oxyMax !== undefined || r.oceansMax !== undefined)) net *= 0.85;
  return net;
}

// ---------------- whole-state evaluation ----------------
export interface StateValueOpts { hideHand?: boolean; clock?: Clock }

/** M€-equivalent value of a player's whole position: points, stock, income, hand and engine. */
export function positionValue(s: GameState, pid: number, w: Weights, opts: StateValueOpts = {}): number {
  const b = positionBreakdown(s, pid, w, opts);
  return b.score + b.stock + b.income + b.engine + b.hand;
}

export function positionBreakdown(s: GameState, pid: number, w: Weights, opts: StateValueOpts = {}) {
  const c = makeCtx(s, pid, w, opts.clock);
  const p = P(s, pid);
  const out = { score: scoreEV(c) * c.vp, stock: 0, income: 0, engine: 0, hand: 0 };
  for (const r of ['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]) out.stock += p.res[r] * resValue(c, r);
  if (!c.last) {
    out.income += (p.tr + p.prod.mc) * prodValue(c, 'mc');
    for (const r of ['steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]) out.income += p.prod[r] * prodValue(c, r);
  }
  // engine: card actions and passive effects still to come
  for (const id of p.corp ? [p.corp, ...p.played] : p.played) {
    const card = CARDS[id];
    if (card.type === 'event') continue;
    out.engine += actionFutureValue(c, id, p.usedActions.includes(id));
    out.engine += passiveValue(c, id);
  }
  // hand: the best cards we can realistically afford and play
  if (opts.hideHand) out.hand += p.hand.length * cardDrawValue(c) * 0.8;
  else out.hand += handValue(c);
  // final-greenery potential for leftover plants in the last generation
  if (c.last) out.stock += Math.floor(p.res.plants / greeneryCost(s, pid)) * c.vp;
  return out;
}

/** Money we can expect to put into cards over the rest of the game (rough). */
export function cardBudget(c: Ctx): number {
  const p = P(c.s, c.pid);
  const stock = p.res.mc + p.res.steel * resValue(c, 'steel') + p.res.titanium * resValue(c, 'titanium');
  const income = p.tr + p.prod.mc + p.prod.steel * 1.5 + p.prod.titanium * 2;
  // part of future income goes to research and standard projects
  return stock + income * Math.max(0, c.G - 1) * 0.55 + income * 0.6;
}

/** The hand's worth: good cards we can fund count most; the rest are mostly sell fodder. */
export function handValue(c0: Ctx, extra?: string): number {
  const c: Ctx = c0.future ? c0 : { ...c0, future: true };
  const p = P(c.s, c.pid);
  const ids = extra ? [...p.hand, extra] : p.hand;
  if (!ids.length) return 0;
  const rows = ids.map((id) => ({ net: cardNetValue(c, id), cost: Math.max(1, cardCost(c.s, c.pid, id)) }))
    .sort((a, b) => b.net / (b.cost + 8) - a.net / (a.cost + 8));
  let budget = cardBudget(c);
  let v = 0;
  for (const r of rows) {
    if (r.net <= 0) { v += 0.4; continue; }
    if (budget >= r.cost) { v += r.net * 0.7; budget -= r.cost; }
    else v += r.net * 0.1 + 0.4;
  }
  return v;
}

/** Hand cards we can't fund; drawing more mostly adds sell fodder. */
export function handOverBudget(c: Ctx): boolean {
  const p = P(c.s, c.pid);
  const want = p.hand.filter((id) => cardNetValue(c, id) > 0).reduce((a, id) => a + cardCost(c.s, c.pid, id), 0);
  return want > cardBudget(c);
}

/** Score with awards weighted by how safe the lead is and unclaimed milestones we're close to. */
export function scoreEV(c: Ctx): number {
  const s = c.s;
  const sc = score(s, c.pid);
  let total = sc.total - sc.awards;
  for (const a of s.awards) {
    const def = AWARDS.find((x) => x.id === a.id)!;
    const mine = def.metric(s, c.pid);
    const others = s.players.filter((q) => q.id !== c.pid).map((q) => def.metric(s, q.id));
    const best = Math.max(...others);
    const margin = mine - best;
    const conf = c.last ? (margin >= 0 ? 1 : 0) : 1 / (1 + Math.exp(-margin / (1 + c.G * 0.8)));
    const pl = awardPlaces(s, a.id);
    // if we don't end up first, a close second still pays in 3+ player games
    const second = s.players.length >= 3 ? (pl.second.includes(c.pid) || pl.first.includes(c.pid) ? 1.6 : 0.6) : 0;
    total += conf * 5 + (1 - conf) * second;
  }
  for (const m of MILESTONES) {
    if (s.milestones.length >= 3 || s.milestones.some((x) => x.id === m.id)) continue;
    // progress toward an open milestone; rises steadily and peaks once we qualify
    const frac = Math.min(1, m.metric(s, c.pid) / m.need);
    const rivals = Math.max(...s.players.filter((q) => q.id !== c.pid).map((q) => m.metric(s, q.id) / m.need));
    const race = rivals >= 1 ? 0.5 : 1; // a rival who already qualifies will likely claim first
    if (frac >= 0.6 && !c.last) total += 5 * 0.6 * Math.pow((frac - 0.6) / 0.4, 2) * race;
  }
  return total;
}

/** City-adjacency aware score of placing a tile on a space. */
export function spaceScore(c: Ctx, id: string, kind: 'city' | 'greenery' | 'ocean' | 'special', card?: string): number {
  const s = c.s;
  const sp = s.board.find((x) => x.id === id)!;
  const pid = c.pid;
  let v = 0;
  for (const b of sp.bonus) v += b === 'card' ? cardDrawValue(c) : resValue(c, b);
  const adj = neighbours(s.board, id);
  v += adj.filter((n) => n.tile?.kind === 'ocean').length * 2 * resValue(c, 'mc');
  const emptyLand = adj.filter((n) => !n.tile && n.type === 'land').length;
  if (kind === 'city') {
    v += adj.filter((n) => n.tile?.kind === 'greenery').length * c.vp;
    v += Math.min(3, emptyLand) * c.vp * (c.last ? 0 : 0.35);
    if (card === 'capital') v += adj.filter((n) => n.tile?.kind === 'ocean' || (n.type === 'ocean' && !n.tile)).length * c.vp * 0.7;
  } else if (kind === 'greenery') {
    for (const n of adj) {
      if (n.tile?.kind !== 'city') continue;
      v += n.tile.owner === pid ? c.vp : -c.w.lambda * c.vp;
    }
    v += adj.filter((n) => n.tile && n.tile.owner === pid).length * 0.3;
    // keep spots next to our own cities free for later, unless this is the end
  } else if (kind === 'ocean') {
    // oceans next to rival cities steal their greenery spots
    v += adj.filter((n) => n.tile?.kind === 'city' && n.tile.owner !== pid).length * c.w.lambda;
    v -= adj.filter((n) => n.tile?.kind === 'city' && n.tile.owner === pid).length * 0.5;
  } else if (card === 'commercial-district') {
    v += adj.filter((n) => n.tile?.kind === 'city').length * c.vp;
  }
  if (kind !== 'ocean' && kind !== 'city' && card !== 'commercial-district') {
    // special tiles and greeneries crowd rivals' city spots when placed near them
    v += adj.filter((n) => n.tile?.kind === 'city' && n.tile.owner !== pid).length * 0.2 * c.w.lambda;
  }
  return v;
}

export { greeneries };
export type { CardDef };
