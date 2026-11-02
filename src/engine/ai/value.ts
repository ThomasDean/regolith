// Engine-aware valuation for CPU players. Everything is expressed in M€-equivalents for one
// player, and depends on how many generations are likely left: production and card draw are
// worth a lot early, victory points dominate late.
import type { CardRes, GameState, Op, Res, Tag } from '../types';
import { TAGS } from '../types';
import { CARDS, PROJECT_IDS, cardInGame, type CardDef } from '../cards';
import { P, cities, greeneries, resCards, tagCount } from '../helpers';
import { maxOceans, maxOxy, maxTemp, neighbours, params, totalSteps, MAX_VENUS } from '../board';
import { gameAwards, gameMilestones, inGame, tagRace, awardDef } from '../ma';
import {
  activeCards, awardCost, buyCost, canPlayCard, cardCost, greeneryCost, payLimitsForCard, requirementGap,
  requirementsMet, score, spaceCostApplies, stepsLeft, steelValue, titaniumValue, venusOf,
} from '../queries';
import { buildableTiles, colonyDef, coloniesInPlay, fleetsFree, tradeCost, tradeTargets, tradeTrack } from '../colonies';
import { T, influence, PARTY_DEFS } from '../turmoil';
import { PARTIES } from '../types';

export interface Weights {
  lambda: number; // how much opponents' gains count against ours
  synergy: boolean; // value tags by how they feed the engine
  tempo: boolean; // speed up or slow down the game depending on who is ahead
  /** play-style multipliers (a CPU's "personality"); absent = neutral */
  style?: Style;
  /** count the chance to shut rivals out of the last award slot (Hard) */
  deny?: boolean;
  /** award points are judged against what rivals expect from the same award (0..1) */
  awardRel?: number;
}

/**
 * Play-style multipliers. Each CPU gets one from the game seed and its seat, so two CPUs in the
 * same game lean different ways but a replayed game plays the same. They are small tilts on top
 * of the evaluation, not different rules.
 */
export interface Style {
  name: string;
  prod: number; // production
  tr: number; // raising global parameters
  tiles: number; // greeneries and cities
  cards: number; // cards in hand and card draw
}
export const NEUTRAL: Style = { name: 'balanced', prod: 1, tr: 1, tiles: 1, cards: 1 };
const STYLES: Style[] = [
  NEUTRAL,
  { name: 'engine', prod: 1.12, tr: 0.94, tiles: 0.95, cards: 1.08 },
  { name: 'terraformer', prod: 0.95, tr: 1.1, tiles: 1.02, cards: 0.95 },
  { name: 'settler', prod: 0.97, tr: 0.98, tiles: 1.15, cards: 0.97 },
];

/** Small deterministic hash -> [0, 1). Used for seat-specific personality, never for game rules. */
export function hash01(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** The play style of seat `pid` in a game with this seed; `amp` scales how pronounced it is. */
export function styleFor(seed: number, pid: number, amp: number): Style {
  if (amp <= 0) return NEUTRAL;
  const base = STYLES[Math.floor(hash01(seed, pid, 1) * STYLES.length)];
  const tilt = (m: number, k: number) => 1 + (m - 1 + (hash01(seed, pid, k) - 0.5) * 0.06) * amp;
  return { name: base.name, prod: tilt(base.prod, 2), tr: tilt(base.tr, 3), tiles: tilt(base.tiles, 4), cards: tilt(base.cards, 5) };
}
const sty = (c: Ctx): Style => c.w.style ?? NEUTRAL;

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

// ---------------- pool statistics ----------------
// How often each tag (and events) turns up among the project cards in this game's deck.
interface PoolStats { tag: Record<Tag, number>; events: { all: number; space: number } }
const POOL = new Map<string, PoolStats>();
function poolStats(s: GameState): PoolStats {
  const key = `${s.options.corporateEra ? 1 : 0}${(['prelude', 'venus', 'colonies', 'turmoil'] as const).map((e) => (s.options.expansions?.[e] ? 1 : 0)).join('')}`;
  let st = POOL.get(key);
  if (!st) {
    const ids = PROJECT_IDS.filter((id) => cardInGame(s, id));
    const tag = Object.fromEntries(TAGS.map((t) => [t, 0])) as Record<Tag, number>;
    const events = { all: 0, space: 0 };
    for (const id of ids) {
      const c = CARDS[id];
      for (const t of new Set(c.tags)) tag[t] += 1 / ids.length;
      if (c.type === 'event') {
        events.all += 1 / ids.length;
        if (c.tags.includes('space')) events.space += 1 / ids.length;
      }
    }
    st = { tag, events };
    POOL.set(key, st);
  }
  return st;
}
/** Cards this player is likely to play for the rest of the game (excluding the hand). */
const futurePlays = (c: Ctx) => Math.max(0, (c.G - 1) * 2.5 + 1);
const handWithTag = (c: Ctx, t: Tag) => P(c.s, c.pid).hand.filter((id) => CARDS[id].tags.includes(t)).length;
const expectedTagPlays = (c: Ctx, t: Tag) => handWithTag(c, t) * 0.7 + futurePlays(c) * poolStats(c.s).tag[t];

// ---------------- unit values ----------------
const tempLeft = (s: GameState) => Math.max(0, (maxTemp(s) - s.temperature) / 2);
const venusLeft = (s: GameState) => (s.venus === undefined ? 0 : Math.max(0, (MAX_VENUS - s.venus) / 2));
const oxyLeft = (s: GameState) => Math.max(0, maxOxy(s) - s.oxygen);
const oceansLeft = (s: GameState) => Math.max(0, maxOceans(s) - s.oceans);

export const trValue = (c: Ctx) => c.vp + (c.last ? 0 : c.G - 0.5);
export const cardDrawValue = (c: Ctx) => {
  if (c.last) return 0.3;
  if (c.drawv === undefined) {
    const base = Math.max(1, Math.min(4, 1 + c.G * 0.45));
    c.drawv = base; // provisional, breaks the cycle through hand valuation
    c.drawv = base * (handOverBudget(c) ? 0.35 : 1) * sty(c).cards;
  }
  return c.drawv;
};

function raiseValue(c: Ctx, param: 'temp' | 'oxy' | 'ocean' | 'venus'): number {
  let v = trValue(c) * sty(c).tr;
  // Venus doesn't bring the end closer
  if (c.w.tempo && param !== 'venus') {
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
  return (c.vp + 1.5) * sty(c).tiles + oxy;
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

/**
 * A heat stockpile is only worth temperature steps while steps remain: with one step left, 40
 * heat is one conversion, not five. Valuing every unit at the per-step rate made the last step
 * look like it destroyed the stockpile, so nobody would take it and games stalled for dozens of
 * generations a step short of the end.
 */
export function heatStockValue(c: Ctx, n: number): number {
  if (n <= 0) return 0;
  const unit = resValue(c, 'heat');
  const p = P(c.s, c.pid);
  const other = Math.max(p.corp === 'helion' ? resValue(c, 'mc') : 0, p.played.includes('caretaker-contract') ? trValue(c) / 8 * 0.8 : 0);
  if (other >= unit) return n * unit;
  const convertible = tempLeft(c.s) * 8;
  return Math.min(n, convertible) * unit + Math.max(0, n - convertible) * other;
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
  return unit * gens * 0.92 * sty(c).prod;
}

// ---------------- card resources ----------------
const RES_PER_VP: Record<string, number> = {
  ants: 2, birds: 1, decomposers: 3, 'ecological-zone': 2, fish: 1, herbivores: 2, livestock: 1, pets: 2, predators: 1,
  'small-animals': 2, tardigrades: 4, 'security-fleet': 1, 'physics-complex': 0.5,
  celestic: 3, 'floating-habs': 2, stratopolis: 3, extremophiles: 3, 'venusian-insects': 2, 'venusian-animals': 1, 'stratospheric-birds': 1,
  arklight: 2, 'jovian-lanterns': 2, 'sub-zero-salt-fish': 2, 'refugee-camps': 1, pristar: 1,
};
/** Card resources that convert: how many per use, and what the use gives. */
const CONVERT: Record<string, { per: number; to: (c: Ctx) => number }> = {
  'extractor-balloons': { per: 2, to: (c) => (venusLeft(c.s) ? raiseValue(c, 'venus') : 0) },
  'forced-precipitation': { per: 2, to: (c) => (venusLeft(c.s) ? raiseValue(c, 'venus') : 0) },
  'jet-stream-microscrappers': { per: 2, to: (c) => (venusLeft(c.s) ? raiseValue(c, 'venus') : 0) },
  thermophiles: { per: 2, to: (c) => (venusLeft(c.s) ? raiseValue(c, 'venus') : 0) },
  'rotator-impacts': { per: 1, to: (c) => (venusLeft(c.s) ? raiseValue(c, 'venus') : 0) },
  'deuterium-export': { per: 1, to: (c) => prodValue(c, 'energy') },
  'local-shading': { per: 1, to: (c) => prodValue(c, 'mc') },
  'aerial-mappers': { per: 1, to: (c) => cardDrawValue(c) },
  'red-spot-observatory': { per: 1, to: (c) => cardDrawValue(c) },
  'titan-air-scrapping': { per: 2, to: (c) => trValue(c) },
  'atmo-collectors': { per: 1, to: (c) => Math.max(2 * resValue(c, 'titanium'), 3 * resValue(c, 'energy'), 4 * resValue(c, 'heat')) },
  'titan-shuttles': { per: 1, to: (c) => resValue(c, 'titanium') },
  'titan-floating-launch-pad': { per: 1, to: (c) => 5 * resValue(c, 'mc') },
  'jupiter-floating-station': { per: 1, to: (c) => resValue(c, 'mc') },
  'sulphur-eating-bacteria': { per: 1, to: (c) => 3 * resValue(c, 'mc') },
  dirigibles: { per: 1, to: (c) => (P(c.s, c.pid).hand.some((h) => CARDS[h].tags.includes('venus')) || !c.last ? 3 * resValue(c, 'mc') * 0.9 : 0) },
  psychrophiles: { per: 1, to: (c) => (P(c.s, c.pid).hand.some((h) => CARDS[h].tags.includes('plant')) || !c.last ? 2 * resValue(c, 'mc') * 0.9 : 0) },
  'stormcraft-incorporated': { per: 1, to: (c) => 2 * resValue(c, 'heat') },
  'martian-zoo': { per: 1, to: (c) => Math.max(0, c.G - 1) * resValue(c, 'mc') },
};
export function resUnitValue(c: Ctx, id: string): number {
  const per = RES_PER_VP[id];
  let v = per ? c.vp / per : 0;
  const cv = CONVERT[id];
  if (cv) v = Math.max(v, cv.to(c) / cv.per);
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
      for (const b of params(s).oxy) {
        if (s.oxygen >= b.at || s.oxygen + n < b.at) continue;
        if (b.bonus === 'temp' && tempLeft(s) > 0) v += raiseValue(c, 'temp');
        if (b.bonus === 'card') v += cardDrawValue(c);
      }
      return v;
    }
    case 'ocean': return oceansLeft(s) > 0 ? raiseValue(c, 'ocean') : 0;
    case 'tile': {
      if (op.tile === 'ocean') return oceansLeft(s) > 0 ? raiseValue(c, 'ocean') : 0;
      if (op.tile === 'greenery') return greeneryValue(c);
      if (op.tile === 'city') {
        const adj = c.last ? 0.5 : Math.min(2.5, 0.6 + c.G * 0.25);
        let v = (adj * c.vp + 1.5) * sty(c).tiles;
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
    case 'venus': {
      if (op.wgt) return 0;
      const n = Math.min(op.n, venusLeft(s));
      let v = n * raiseValue(c, 'venus');
      const at = venusOf(s);
      for (let i = 1; i <= n; i++) {
        if (at + 2 * i === 8) v += cardDrawValue(c);
        if (at + 2 * i === 16) v += trValue(c);
      }
      if (P(s, c.pid).corp === 'aphrodite') v += 2 * op.n * resValue(c, 'mc');
      return v;
    }
    case 'lowerTemp': case 'wgt': case 'removeOcean': return 0;
    case 'spendRes': {
      const units = resCards(s, c.pid, op.rtype).filter((id) => (P(s, c.pid).cardRes[id] ?? 0) >= op.n).map((id) => resUnitValue(c, id));
      return units.length ? -op.n * Math.min(...units) : 0;
    }
    case 'drawMatching': return op.n * cardDrawValue(c) * 1.15;
    case 'discard': return -Math.min(op.n, P(s, c.pid).hand.length) * Math.min(1, cardDrawValue(c) * 0.4);
    case 'othersDraw': return -c.w.lambda * op.n * cardDrawValue(c) * (s.players.length - 1) * 0.5;
    case 'playFromHand': {
      let best = 0;
      for (const h of P(s, c.pid).hand) {
        if (!canPlayCard(s, c.pid, h, { discount: op.discount, ignoreReq: op.ignoreReq })) continue;
        best = Math.max(best, cardCoreValue(c, h) - Math.max(0, cardEffectiveCost(c, h) - op.discount * resValue(c, 'mc')));
      }
      return best;
    }
    case 'preludeDraw': return 13 * resValue(c, 'mc');
    case 'freeAward': return 2.5 * c.vp;
    case 'viron': return 4 * resValue(c, 'mc');
    case 'lowestProd': {
      const p = P(s, c.pid);
      const min = Math.min(...(['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]).map((r) => p.prod[r]));
      return Math.max(...(['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]).filter((r) => p.prod[r] === min).map((r) => prodValue(c, r)));
    }
    case 'pay': return -op.n * resValue(c, 'mc') * (op.titanium ? 0.85 : 1);
    case 'colony': {
      const tiles = buildableTiles(s, c.pid, op.dup);
      return tiles.length ? Math.max(...tiles.map((t) => colonyValue(c, t.id))) : 0;
    }
    case 'fleet': return fleetValue(c) + 0.5 * tradeNet(c);
    case 'trade': return Math.max(0, ...tradeTargets(s).map((t) => tradeGain(c, t.id)));
    case 'addColonyTile': return 1.5;
    case 'marketManip': return 1.5;
    case 'colonyBonuses': {
      let v = 0;
      for (const t of coloniesInPlay(s)) for (const o of t.colonies) if (o === c.pid) v += colonyDef(t.id).bonus.reduce((a, x) => a + opValue(c, x), 0);
      return v;
    }
    case 'delegate': return (op.one ? op.n : op.n) * delegateValue(c);
    case 'removeDelegate': return 1;
    case 'recruit': return 2;
    case 'noConfidence': return 0.5 * trValue(c);
  }
}

// ---------------- Colonies ----------------
/** Trades each colony tile is likely to see per generation (rough). */
const tradesPerTile = (s: GameState) => {
  const fleets = s.players.reduce((a, p) => a + (p.fleets ?? 0), 0);
  const tiles = Math.max(1, coloniesInPlay(s).filter((t) => t.active).length);
  return Math.min(1, fleets * 0.6 / tiles);
};
/** A colony: the build bonus now, plus its colony bonus whenever anyone trades there. */
export function colonyValue(c: Ctx, id: string): number {
  const d = colonyDef(id);
  const now = d.build.reduce((a, x) => a + opValue(c, x), 0);
  const bonus = d.bonus.reduce((a, x) => a + opValue(c, x), 0);
  return now + bonus * tradesPerTile(c.s) * Math.max(0, c.G - 1) + (c.last ? 0 : 1);
}
/** What one trade with a tile is worth now, before its cost. */
export function tradeGain(c: Ctx, id: string): number {
  const t = coloniesInPlay(c.s).find((x) => x.id === id)!;
  const d = colonyDef(id);
  let v = d.trade(tradeTrack(c.s, c.pid, t)).reduce((a, x) => a + opValue(c, x), 0);
  for (const o of t.colonies) {
    const b = d.bonus.reduce((a, x) => a + opValue(o === c.pid ? c : { ...c, pid: o }, x), 0);
    v += o === c.pid ? b : -c.w.lambda * b;
  }
  return v;
}
/** Net worth of one trade at today's tracks and prices. */
export function tradeNet(c: Ctx): number {
  if (!c.s.colonies) return 0;
  const cost = Math.min(tradeCost(c.s, c.pid, 'mc') * resValue(c, 'mc'), tradeCost(c.s, c.pid, 'energy') * Math.max(0.6, resValue(c, 'energy')), tradeCost(c.s, c.pid, 'titanium') * resValue(c, 'titanium'));
  const best = Math.max(0, ...coloniesInPlay(c.s).filter((t) => t.active).map((t) => tradeGain(c, t.id)));
  return Math.max(0, best - cost);
}
/** A trade fleet: about one good trade in each generation still to come (this one is counted separately). */
export function fleetValue(c: Ctx): number {
  if (c.last || !c.s.colonies) return 0;
  return tradeNet(c) * 0.6 * Math.max(0, c.G - 1);
}

// ---------------- Turmoil ----------------
/** A delegate's worth: a shot at the chairman's TR, influence for events, party requirements. */
export function delegateValue(c: Ctx): number {
  if (!c.s.turmoil || c.last) return 0;
  return 0.25 * trValue(c) + 1.5 * resValue(c, 'mc');
}
/** Standing in the parties: likely chairmanship, influence, and party leaders (Political Alliance…). */
export function turmoilTerm(c: Ctx): number {
  const s = c.s;
  if (!s.turmoil || c.last) return 0;
  const t = T(s);
  let v = 0;
  const max = Math.max(...PARTIES.map((p) => t.parties[p].delegates.length));
  for (const party of PARTIES) {
    const ps = t.parties[party];
    if (ps.leader !== c.pid) continue;
    // leading the party that will rule: the chairman's TR, the ruling bonus is shared
    const share = party === t.dominant ? 0.85 : max ? 0.3 * ps.delegates.length / max : 0;
    v += share * trValue(c);
  }
  v += influence(s, c.pid) * 2 * resValue(c, 'mc');
  // delegates in a party our hand needs (2 there unlock its cards)
  for (const h of P(s, c.pid).hand) {
    const need = CARDS[h].req?.party;
    if (need && t.ruling !== need && t.parties[need].delegates.filter((d) => d === c.pid).length >= 2) v += 1.5;
  }
  // the coming ruling party's bonus
  const bonus = PARTY_DEFS[t.dominant].bonus(s, c.pid).reduce((a, x) => a + opValue(c, x), 0);
  v += bonus * 0.5;
  void buyCost;
  return v;
}

function mayorValue(c: Ctx): number {
  if (!inGame(c.s, 'mayor') || c.s.milestones.length >= 3 || c.s.milestones.some((m) => m.id === 'mayor')) return 0;
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
    case 'media-group': v += (futurePlays(c) * poolStats(s).events.all + handEvents(c)) * 3; break;
    case 'interplanetary-cinematics': v += (futurePlays(c) * poolStats(s).events.all + handEvents(c)) * 2; break;
    case 'optimal-aerobraking': v += (futurePlays(c) * poolStats(s).events.space + handEvents(c, 'space')) * (3 + 3 * resValue(c, 'heat')); break;
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
    case 'point-luna': v += expectedTagPlays(c, 'earth') * cardDrawValue(c); break;
    case 'arklight': v += bio(['plant', 'animal']) * c.vp / 2; break;
    case 'venusian-animals': v += expectedTagPlays(c, 'science') * c.vp; break;
    case 'martian-zoo': v += expectedTagPlays(c, 'earth') * Math.max(0, c.G - 1.5) * resValue(c, 'mc') * 0.5; break;
    case 'gmo-contract': v += bio(['plant', 'animal', 'microbe']) * 2 * resValue(c, 'mc'); break;
    case 'spin-off-department': v += futurePlays(c) * 0.22 * cardDrawValue(c); break;
    case 'vitor': v += futurePlays(c) * 0.3 * 3 * resValue(c, 'mc'); break;
    case 'aphrodite': v += Math.min(venusLeft(s), c.G * s.players.length * 0.7) * 2 * resValue(c, 'mc'); break;
    case 'manutech': v += c.G * 1.5 * resValue(c, 'mc'); break;
    case 'poseidon': v += Math.max(0, c.G - 1) * s.players.length * 0.4 * prodValue(c, 'mc') * 0.5; break;
    case 'lakefront-resorts': v += (maxOceans(s) - s.oceans) * prodValue(c, 'mc') * 0.5; break;
    case 'aridor': v += 2 * prodValue(c, 'mc'); break;
    case 'polyphemos': v -= c.G * 1.5 * 2 * resValue(c, 'mc'); break;
    case 'terralabs-research': v += c.G * 1.5 * 2 * resValue(c, 'mc'); break;
    case 'pristar': v += Math.min(c.G, 3) * 0.4 * (c.vp + 6 * resValue(c, 'mc')); break;
    case 'event-analysts': v += Math.max(0, c.G - 1) * 2 * resValue(c, 'mc'); break;
    case 'cryo-sleep': case 'rim-freighters': v += (p.fleets ?? 0) * Math.max(0, c.G - 1) * 0.7 * resValue(c, 'mc') * 2; break;
    case 'trade-envoys': case 'trading-colony': v += (p.fleets ?? 0) * Math.max(0, c.G - 1) * 0.6 * 2 * resValue(c, 'mc'); break;
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
  // UNMI only fires in generations where our TR already rose and 3 M€ and an action are spare,
  // and each later use is worth less than today's TR; counting every generation at today's
  // value made it the CPUs' pick 17 times out of 17 while it won 24% of those games
  if (id === 'united-nations-mars-initiative') uses *= 0.6;
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
  if (s.milestones.length < 3) {
    for (const m of gameMilestones(s)) {
      if (!tagRace(m.id)?.includes(t) || s.milestones.some((x) => x.id === m.id)) continue;
      const have = m.metric(s, c.pid);
      if (have >= m.need / 2 && have < m.need) v += (5 * c.vp) / (m.need - have) * 0.4;
    }
  }
  for (const a of s.awards) if (tagRace(a.id)?.includes(t)) v += c.vp * 0.6 / tagRace(a.id)!.length;
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
  for (const r of ['mc', 'steel', 'titanium', 'plants', 'energy'] as Res[]) out.stock += p.res[r] * resValue(c, r);
  out.stock += heatStockValue(c, p.res.heat);
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
  // expansions: colonies owned, spare trade fleets, standing in the parties, preludes still to play
  if (c.s.colonies && !c.last) {
    for (const t of coloniesInPlay(s)) for (const o of t.colonies) if (o === pid) out.engine += colonyDef(t.id).bonus.reduce((a, x) => a + opValue(c, x), 0) * tradesPerTile(s) * Math.max(0, c.G - 1);
    // fleets keep trading in later generations; a fleet still home this generation is an option worth about half a trade
    out.engine += (p.fleets ?? 0) * fleetValue(c) + Math.max(0, fleetsFree(s, pid)) * 0.5 * tradeNet(c);
  }
  out.engine += turmoilTerm(c);
  for (const pre of p.preludes ?? []) out.hand += cardCoreValue(c, pre);
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
  return v * sty(c).cards;
}

/** Hand cards we can't fund; drawing more mostly adds sell fodder. */
export function handOverBudget(c: Ctx): boolean {
  const p = P(c.s, c.pid);
  const want = p.hand.filter((id) => cardNetValue(c, id) > 0).reduce((a, id) => a + cardCost(c.s, c.pid, id), 0);
  return want > cardBudget(c);
}

// ---------------- awards ----------------
/**
 * Generations of play really left, for award forecasting. The horizon is deliberately short
 * (it tightens the economy); measured over CPU games, the game actually lasts about 10% longer
 * plus one generation (scripts/horizon-check.ts).
 */
// (the horizon also swings early on after a fast first generation, so it's floored by the
// typical game length)
const awardGensLeft = (c: Ctx) => (c.last ? 0.25 : Math.min(14 * stretch(c.s), Math.max(c.G * 1.1 + 0.8, 0.7 * (13 * stretch(c.s) - c.s.generation))));
/** How much longer this board's tracks make a game than Tharsis' 42 steps. */
const stretch = (s: GameState) => totalSteps(s) / 42;

// Spread of each award metric per sqrt(generation), and how the leader's gap tends to grow, live
// on the award definitions (src/engine/ma.ts), fitted on seeded CPU games (scripts/award-drift.ts).

/** Forecast of a player's final award metric: mean and standard deviation. */
export function awardProjection(s: GameState, pid: number, id: string, gensLeft: number, last = false): { mean: number; sd: number } {
  const def = awardDef(id);
  const cur = def.metric(s, pid);
  const d = def.drift;
  const L = Math.max(0.25, gensLeft);
  const p = P(s, pid);
  let mean = cur * (1 + d.widen * Math.min(L, 8));
  if (def.project === 'heat') {
    // energy turns into heat at production; heat production keeps coming
    const k = last ? 1 : Math.min(2.4, 0.7 * L + 0.3);
    mean = cur + p.res.energy + (p.prod.heat + p.prod.energy) * k;
  } else if (def.project === 'steelEnergy') {
    // steel gets spent like Miner's; energy turns to heat, leaving one generation's production at the end
    const keep = last ? 1 : Math.max(0.4, 1 - 0.12 * (L - 1));
    const k = last ? 1 : Math.min(5, 0.9 * Math.max(0, L - 1) + 0.8);
    mean = p.res.steel * keep + p.prod.steel * k + (last ? p.res.energy : p.prod.energy);
  } else if (def.project === 'metal') {
    // stocks get spent on building/space cards; production refills them
    const keep = last ? 1 : Math.max(0.4, 1 - 0.12 * (L - 1));
    const k = last ? 1 : Math.min(5, 0.9 * Math.max(0, L - 1) + 0.8);
    mean = cur * keep + (p.prod.steel + p.prod.titanium) * k;
  }
  return { mean, sd: d.sd * Math.sqrt(L) };
}

const phi = (z: number) => {
  // standard normal CDF (Abramowitz-Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

/**
 * Expected award points (5 for first, 2 for second with 3+ players) for every player, from the
 * forecast above. A funded award isn't banked at face value: a lead that can still flip, or
 * that rivals can catch, is worth correspondingly less.
 */
export function awardEV(s: GameState, id: string, gensLeft: number, last = false, spread = 1): number[] {
  const proj = s.players.map((q) => {
    const pr = awardProjection(s, q.id, id, gensLeft, last);
    return { mean: pr.mean, sd: pr.sd * spread };
  });
  const n = s.players.length;
  return s.players.map((q) => {
    const me = proj[q.id];
    const beat = s.players.filter((r) => r.id !== q.id).map((r) => {
      const o = proj[r.id];
      // ties for first both score first, hence the half-step
      return phi((me.mean - o.mean + 0.5) / Math.max(0.35, Math.hypot(me.sd, o.sd)));
    });
    const first = beat.reduce((a, b) => a * b, 1);
    let second = 0;
    if (n >= 3) for (let i = 0; i < beat.length; i++) second += (1 - beat[i]) * beat.reduce((a, b, j) => (j === i ? a : a * b), 1);
    return 5 * first + 2 * second;
  });
}

const awardNet = (ev: number[], pid: number, rel: number) =>
  ev[pid] - rel * ev.reduce((x, y, i) => (i === pid ? x : x + y), 0) / (ev.length - 1);

// probabilists' Gauss-Hermite nodes for E[f(Z)], Z ~ N(0, 1)
const GH = [[0, 0.5333], [1.3556, 0.2221], [-1.3556, 0.2221], [2.857, 0.01126], [-2.857, 0.01126]];

/**
 * What it's worth to keep the right to fund this award later, in VP. Waiting lets us fund it
 * only if we're still ahead near the end; funding now locks in whatever the lead is worth today.
 * Modelled as a decision with ~1.5 generations left: by then most of the uncertainty about the
 * final margin over the strongest rival has resolved, and we fund only if it pays.
 */
function awardOption(c: Ctx, id: string, L: number, costVP: number, rel: number): number {
  const s = c.s;
  if (L <= 1.6) return 0;
  const proj = s.players.map((q) => awardProjection(s, q.id, id, L));
  let rival = -1;
  for (const q of s.players) if (q.id !== c.pid && (rival < 0 || proj[q.id].mean > proj[rival].mean)) rival = q.id;
  const me = proj[c.pid], ri = proj[rival];
  const late = awardDef(id).drift.sd * Math.sqrt(1.5) * Math.SQRT2; // margin spread over the last stretch
  const total = Math.hypot(me.sd, ri.sd);
  const known = Math.sqrt(Math.max(0, total * total - late * late));
  const mu = me.mean - ri.mean;
  const n = s.players.length;
  let v = 0;
  for (const [z, w] of GH) {
    const m = mu + z * known;
    const p = phi((m + 0.5) / late);
    const mine = 5 * p + (n >= 3 ? (1 - p) : 0);
    const theirs = 5 * (1 - p) + (n >= 3 ? 2 * p : 0);
    v += w * Math.max(0, mine - rel * theirs / (n - 1) - costVP);
  }
  return v;
}

/**
 * Award points measured against the table: our expected points minus `rel` times what each
 * rival expects on average (funding hands points to everyone in the race), plus the value of
 * award slots we could still fund later.
 */
function awardsTerm(c: Ctx): number {
  const s = c.s;
  const L = awardGensLeft(c);
  const rel = c.w.awardRel ?? 0;
  let total = 0;
  // a funded award is public: rivals now steer toward it, so its outcome is less settled than
  // the same lead in an unfunded race
  for (const a of s.awards) total += awardNet(awardEV(s, a.id, L, c.last, 1.2), c.pid, rel);
  const open = 3 - s.awards.length;
  if (open > 0 && !c.last) {
    // the slot may be gone or dearer by the time we want it
    const costLater = [11, 17, 20][s.awards.length];
    const costVP = costLater * 0.7 / 9.5; // late-game M€ and VP rates
    const avail = [0.8, 0.65, 0.5][s.awards.length];
    const opts: number[] = [];
    for (const def of gameAwards(s)) if (!s.awards.some((a) => a.id === def.id)) opts.push(awardOption(c, def.id, L, costVP, rel));
    opts.sort((x, y) => y - x);
    total += avail * ((opts[0] ?? 0) + (open > 1 ? 0.35 * (opts[1] ?? 0) : 0));
  }
  // denial (Hard): while slots are open a rival can fund an award they're winning
  if (c.w.deny && open > 0) {
    let threat = 0;
    for (const def of gameAwards(s)) {
      if (s.awards.some((a) => a.id === def.id)) continue;
      const ev = awardEV(s, def.id, L, c.last);
      for (const q of s.players) {
        if (q.id === c.pid) continue;
        if (q.res.mc + q.tr + q.prod.mc < awardCost(s)) continue;
        threat = Math.max(threat, ev[q.id] - ev[c.pid] - 2);
      }
    }
    total -= 0.35 * threat * (c.G <= 3 ? 1 : 0.4);
  }
  return total;
}

/** Score with awards weighted by how safe the lead is and unclaimed milestones we're close to. */
export function scoreEV(c: Ctx): number {
  const s = c.s;
  const sc = score(s, c.pid);
  let total = sc.total - sc.awards + awardsTerm(c);
  for (const m of gameMilestones(s)) {
    if (s.milestones.length >= 3 || s.milestones.some((x) => x.id === m.id)) continue;
    // progress toward an open milestone; rises steadily and peaks once we qualify
    const frac = Math.min(1, m.metric(s, c.pid) / m.need);
    const rivals = Math.max(...s.players.filter((q) => q.id !== c.pid).map((q) => m.metric(s, q.id) / m.need));
    const race = rivals >= 1 ? 0.5 : 1; // a rival who already qualifies will likely claim first
    if (frac >= 0.6 && !c.last) total += 5 * 0.6 * Math.pow((frac - 0.6) / 0.4, 2) * race;
  }
  return total;
}

/** What a space's placement bonuses are worth, net of any M€ it charges. */
export function bonusValue(c: Ctx, sp: GameState['board'][number]): number {
  const s = c.s;
  const charged = spaceCostApplies(s, sp);
  let v = charged ? -sp.cost! * resValue(c, 'mc') : 0;
  for (const b of sp.bonus) {
    if (b === 'delegate') { v += delegateValue(c); continue; }
    if (b === 'card') v += cardDrawValue(c);
    else if (b === 'wild') v += Math.max(...(['mc', 'steel', 'titanium', 'plants', 'energy', 'heat'] as Res[]).map((r) => resValue(c, r)));
    else if (b === 'ocean') v += charged ? raiseValue(c, 'ocean') : 0;
    else if (b === 'temp') v += charged ? raiseValue(c, 'temp') : 0;
    else v += resValue(c, b);
  }
  return v;
}

/** City-adjacency aware score of placing a tile on a space. */
export function spaceScore(c: Ctx, id: string, kind: 'city' | 'greenery' | 'ocean' | 'special', card?: string): number {
  const s = c.s;
  const sp = s.board.find((x) => x.id === id)!;
  const pid = c.pid;
  let v = 0;
  v += bonusValue(c, sp);
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
