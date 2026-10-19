// CPU players. Each turn the CPU simulates every legal action on a copy of the game (with the
// deck reshuffled so it can't peek), answers any follow-up prompts, and scores the resulting
// position with an engine-aware evaluation. Difficulty changes how much it weighs opponents,
// whether it values tag synergies, how noisy its judgement is, and whether it looks ahead.
import type { Action, GameState, Level, Op, Prompt } from '../types';
import { CARDS } from '../cards';
import { P, tagCount } from '../helpers';
import { applyActionMut } from '../game';
import { shuffle } from '../rng';
import { promptAnswers, turnActions } from '../moves';
import { availableSpaces, greeneryCost, score } from '../queries';
import {
  cardDrawValue, cardNetValue, clockOf, handValue, hash01, horizon, makeCtx, type Clock, opValue, positionValue, prodValue, resUnitValue, resValue,
  spaceScore, styleFor, type Ctx, type Weights,
} from './value';

export interface CpuConfig {
  weights: Weights;
  noise: number; // std-dev of judgement noise, in M€
  blunder: number; // chance of a random (legal) move on any decision
  lookahead: boolean; // consider the second action of the turn
  samples: number; // determinizations for actions that draw cards
  researchMargin: number; // net value a card must clear before buying it
  personality: number; // how pronounced the seat's play style is (0 = none)
}

export const LEVELS: Record<Level, CpuConfig> = {
  easy: { weights: { lambda: 0, synergy: false, tempo: false, awardRel: 0.3 }, noise: 6, blunder: 0.12, lookahead: false, samples: 1, researchMargin: 0, personality: 1.3 },
  normal: { weights: { lambda: 0.3, synergy: true, tempo: false, awardRel: 1 }, noise: 1.5, blunder: 0, lookahead: false, samples: 1, researchMargin: 1.5, personality: 1 },
  hard: { weights: { lambda: 0.6, synergy: true, tempo: true, awardRel: 1, deny: true }, noise: 0, blunder: 0, lookahead: true, samples: 3, researchMargin: 1, personality: 0.6 },
};

/** The level's settings with this seat's play style mixed in (fixed for the whole game). */
export function seatConfig(s: GameState, pid: number, level: Level): CpuConfig {
  const cfg = LEVELS[level];
  return { ...cfg, weights: { ...cfg.weights, style: styleFor(s.options.seed, pid, cfg.personality) } };
}

/**
 * A seeded random source for one decision, derived from the game state. CPU choices are a pure
 * function of the state, so a game replays (or runs server-side) identically without Math.random.
 */
export function stateRnd(s: GameState): Rnd {
  const tiles = s.board.reduce((a, x) => a + (x.tile ? 1 : 0), 0);
  const mc = s.players.reduce((a, p) => a * 31 + p.res.mc + p.hand.length * 7 + p.tr * 131, 7);
  let t = Math.floor(hash01(s.options.seed, s.rng, s.generation, s.active, s.actionsThisTurn, tiles, mc, s.prompt ? s.prompt.pid + 1 : 0) * 2 ** 32) | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

type Rnd = () => number;
const gauss = (rnd: Rnd) => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

/** Relative value of a position: ours minus a share of the strongest rival's. */
export function evaluate(s: GameState, pid: number, cfg: CpuConfig, clock: Clock = clockOf(s)): number {
  const mine = positionValue(s, pid, cfg.weights, { clock });
  if (!cfg.weights.lambda) return mine;
  let best = -Infinity;
  // rivals are judged without our own play-style tilt, and by their own award points only (our
  // side already nets the award race against them)
  const rw: Weights = { ...cfg.weights, style: undefined, awardRel: 0, deny: false };
  for (const q of s.players) if (q.id !== pid) best = Math.max(best, positionValue(s, q.id, rw, { hideHand: true, clock }));
  return mine - cfg.weights.lambda * best;
}

/** Pick the next action for whichever CPU must decide now. */
export function cpuAction(s: GameState, level: Level, rnd: Rnd = stateRnd(s)): Action {
  const pid = s.prompt ? s.prompt.pid : s.active;
  const cfg = seatConfig(s, pid, level);
  if (cfg.blunder && rnd() < cfg.blunder && s.phase === 'action' && !s.prompt) {
    // a careless move: pick a kind of action first, then one of that kind, so the five award
    // fundings (or a hand full of plays) don't crowd out everything else; never throw away 8-20
    // M€ on an award by accident
    const acts = turnActions(s).filter((a) => a.t !== 'pass' && a.t !== 'endTurn' && a.t !== 'award');
    const kinds = [...new Set(acts.map((a) => (a.t === 'sp' ? `sp:${a.id}` : a.t)))];
    if (kinds.length) {
      const k = kinds[Math.floor(rnd() * kinds.length)];
      const of = acts.filter((a) => (a.t === 'sp' ? `sp:${a.id}` : a.t) === k);
      return of[Math.floor(rnd() * of.length)];
    }
  }
  if (s.prompt) return answerPrompt(s, s.prompt, cfg, rnd);
  switch (s.phase) {
    case 'setup': return chooseSetup(s, pid, cfg, rnd);
    case 'research': return chooseResearch(s, pid, cfg, rnd);
    case 'finalGreenery':
      return P(s, pid).res.plants >= greeneryCost(s, pid) && availableSpaces(s, pid, 'greenery', 'greenery').length ? { t: 'plants' } : { t: 'pass' };
    default: return chooseTurn(s, pid, cfg, rnd);
  }
}

// ---------------- simulation ----------------
function sandbox(s: GameState, rnd: Rnd): GameState {
  const log = s.log;
  (s as { log: GameState['log'] }).log = [];
  const c = structuredClone(s);
  (s as { log: GameState['log'] }).log = log;
  // determinize hidden information: the deck order is unknown to the CPU
  c.rng = Math.floor(rnd() * 2 ** 31);
  shuffle(c, c.deck);
  return c;
}

function simulate(s: GameState, a: Action, pid: number, cfg: CpuConfig, rnd: Rnd): GameState | null {
  const c = sandbox(s, rnd);
  try {
    applyActionMut(c, a);
    for (let i = 0; i < 25 && c.prompt && c.prompt.pid === pid; i++) applyActionMut(c, answerPrompt(c, c.prompt, cfg, rnd, true));
  } catch {
    return null;
  }
  return c;
}

function valueAfter(s: GameState, a: Action, pid: number, cfg: CpuConfig, rnd: Rnd, clock: Clock = clockOf(s)): number | null {
  let total = 0, n = 0;
  for (let i = 0; i < cfg.samples; i++) {
    const sim = simulate(s, a, pid, cfg, rnd);
    if (!sim) return null;
    total += evaluate(sim, pid, cfg, clock);
    n++;
    if (sim.reveal === s.reveal) break; // deterministic outcome; one sample is enough
  }
  return total / n;
}

// ---------------- turn actions ----------------
function candidates(s: GameState, pid: number, ctx: Ctx): Action[] {
  const acts = turnActions(s).filter((a) => a.t !== 'pass' && a.t !== 'endTurn' && !(a.t === 'sp' && a.id === 'sell'));
  // selling patents: dump cards that are worth less than the 1 M€ they fetch
  const p = P(s, pid);
  const junk = p.hand.filter((id) => cardNetValue(ctx, id) < (ctx.last ? 10 : 0.5));
  if (junk.length) acts.push({ t: 'sp', id: 'sell', cards: junk });
  return acts;
}

/** Debug helper: every candidate with its estimated gain. */
export function explainTurn(s: GameState, level: Level, rnd: Rnd = stateRnd(s)) {
  const pid = s.active;
  const cfg = seatConfig(s, pid, level);
  const clock = clockOf(s);
  const ctx = makeCtx(s, pid, cfg.weights, clock);
  const base = evaluate(s, pid, cfg, clock);
  return candidates(s, pid, ctx).map((a) => ({ a, v: (valueAfter(s, a, pid, cfg, rnd, clock) ?? NaN) - base })).sort((x, y) => y.v - x.v);
}

function chooseTurn(s: GameState, pid: number, cfg: CpuConfig, rnd: Rnd): Action {
  const clock = clockOf(s);
  const ctx = makeCtx(s, pid, cfg.weights, clock);
  const base = evaluate(s, pid, cfg, clock);
  const scored: { a: Action; v: number; sim?: GameState }[] = [];
  for (const a of candidates(s, pid, ctx)) {
    const v = valueAfter(s, a, pid, cfg, rnd, clock);
    if (v === null) continue;
    scored.push({ a, v: v - base + gauss(rnd) * cfg.noise });
  }
  scored.sort((x, y) => y.v - x.v);
  if (cfg.lookahead && s.actionsThisTurn === 0) {
    // a good first action can set up a great second one (e.g. a discount before a big play)
    for (const sc of scored.slice(0, 3)) {
      const sim = simulate(s, sc.a, pid, cfg, rnd);
      if (!sim || sim.phase !== 'action' || sim.active !== pid || sim.prompt) continue;
      const after = evaluate(sim, pid, cfg, clock);
      let bestNext = 0;
      for (const b of candidates(sim, pid, makeCtx(sim, pid, cfg.weights, clock)).slice(0, 40)) {
        const v = valueAfter(sim, b, pid, { ...cfg, samples: 1 }, rnd, clock);
        if (v !== null) bestNext = Math.max(bestNext, v - after);
      }
      sc.v += bestNext * 0.35;
    }
    scored.sort((x, y) => y.v - x.v);
  }
  const best = scored[0];
  if (best && best.v > 0.25) return best.a;
  return s.actionsThisTurn >= 1 ? { t: 'endTurn' } : { t: 'pass' };
}

// ---------------- research & setup ----------------
/** Greedily buy cards whose marginal hand value beats their 3 M€ price. */
function pickCards(ctx: Ctx, offer: string[], cfg: CpuConfig, rnd: Rnd, priceEach: number): string[] {
  const p = P(ctx.s, ctx.pid);
  const keep: string[] = [];
  const ranked = offer.map((id) => ({ id, v: cardNetValue(ctx, id) + gauss(rnd) * cfg.noise })).sort((a, b) => b.v - a.v);
  const mcv = resValue(ctx, 'mc');
  for (const { id, v } of ranked) {
    if ((keep.length + 1) * priceEach > p.res.mc) break;
    if (v - priceEach < cfg.researchMargin) continue;
    const before = handValue(ctx);
    p.hand.push(id);
    p.res.mc -= priceEach;
    ctx.drawv = undefined; ctx.mcv = undefined;
    const after = handValue(ctx);
    p.hand.pop();
    p.res.mc += priceEach;
    ctx.drawv = undefined; ctx.mcv = undefined;
    if (after - before - priceEach * mcv > cfg.researchMargin + gauss(rnd) * cfg.noise * 0.5) {
      keep.push(id);
      p.hand.push(id); // later picks see the cards already kept
      p.res.mc -= priceEach;
    }
  }
  p.hand.splice(p.hand.length - keep.length, keep.length);
  p.res.mc += keep.length * priceEach;
  return keep;
}

function chooseResearch(s: GameState, pid: number, cfg: CpuConfig, rnd: Rnd): Action {
  const trial = sandbox(s, rnd);
  const ctx: Ctx = { ...makeCtx(trial, pid, cfg.weights), future: true };
  return { t: 'research', keep: pickCards(ctx, P(trial, pid).research ?? [], cfg, rnd, 3) };
}

function chooseSetup(s: GameState, pid: number, cfg: CpuConfig, rnd: Rnd): Action {
  const su = P(s, pid).setup!;
  let best: { a: Action; v: number } | null = null;
  const corps = su.corps.filter((c) => c !== 'beginner-corporation');
  for (const corp of corps) {
    const trial = sandbox(s, rnd);
    applyActionMut(trial, { t: 'setup', corp, keep: [] });
    const tp = P(trial, pid);
    tp.hand = [];
    const ctx: Ctx = { ...makeCtx(trial, pid, cfg.weights), future: true };
    const keep = pickCards(ctx, su.cards, cfg, rnd, 3);
    tp.hand = keep;
    tp.res.mc -= keep.length * 3;
    const v = positionValue(trial, pid, cfg.weights) + gauss(rnd) * cfg.noise * 2;
    if (!best || v > best.v) best = { a: { t: 'setup', corp, keep }, v };
  }
  return best!.a;
}

// ---------------- prompts ----------------
export function answerPrompt(s: GameState, pr: Prompt, cfg: CpuConfig, rnd: Rnd, fast = false): Action {
  const pid = pr.pid;
  const ctx = makeCtx(s, pid, cfg.weights);
  const jitter = () => (fast ? 0 : gauss(rnd) * cfg.noise * 0.3);
  const pick = <T>(xs: T[], f: (x: T) => number): T => {
    let bestX = xs[0], bestV = -Infinity;
    for (const x of xs) {
      const v = f(x) + jitter();
      if (v > bestV) { bestV = v; bestX = x; }
    }
    return bestX;
  };
  const op = pr.item.op;
  switch (pr.kind) {
    case 'space': {
      const kind = op.k === 'tile' ? op.tile : 'special';
      const card = op.k === 'tile' ? op.card : undefined;
      if (op.k === 'tile' && op.rule === 'claim') return { t: 'answer', space: pick(pr.options, (id) => spaceScore(ctx, id, 'special')) };
      return { t: 'answer', space: pick(pr.options, (id) => spaceScore(ctx, id, kind, card)) };
    }
    case 'player': {
      const scores = s.players.map((q) => score(s, q.id).total);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const val = (target: number | null): number => {
        if (target === null) return 0;
        const q = P(s, target);
        const lead = 1 + Math.max(-0.5, (scores[target] - avg) / 15);
        if (op.k === 'decProd') {
          const hurt = op.n * prodValue(target === pid ? ctx : makeCtx(s, target, cfg.weights), op.r);
          return target === pid ? -hurt : Math.max(0.05, cfg.weights.lambda) * hurt * lead;
        }
        if (op.k === 'removeAny' || op.k === 'steal') {
          const n = Math.min(op.n, q.res[op.r]);
          const tctx = makeCtx(s, target, cfg.weights);
          if (target === pid) return -n * resValue(ctx, op.r);
          return n * resValue(tctx, op.r) * Math.max(0.05, cfg.weights.lambda) * lead + (op.k === 'steal' ? n * resValue(ctx, op.r) : 0);
        }
        return 0;
      };
      const opts: (number | null)[] = [...pr.options, ...(pr.optional ? [null] : [])];
      return { t: 'answer', player: pick(opts, val) };
    }
    case 'card': {
      const val = (card: string | null): number => {
        if (card === null) return 0;
        if (op.k === 'addRes') return resUnitValue(ctx, card);
        if (op.k === 'robotic') {
          try {
            return CARDS[card].play!(s, pid, card).filter((o) => o.k === 'prod').reduce((a, o) => a + opValue(ctx, o, card), 0);
          } catch { return 0; }
        }
        if (op.k === 'removeCardRes') {
          const owner = s.players.find((q) => q.played.includes(card))!;
          const unit = resUnitValue(makeCtx(s, owner.id, cfg.weights), card);
          return owner.id === pid ? -unit : unit * Math.max(0.1, cfg.weights.lambda);
        }
        return 0;
      };
      const opts: (string | null)[] = [...pr.options, ...(pr.optional ? [null] : [])];
      return { t: 'answer', card: pick(opts, val) };
    }
    case 'choice': {
      const ch = op as Extract<Op, { k: 'choose' }>;
      const idx = ch.options.map((_, i) => i).filter((i) => ch.options[i].ok);
      return { t: 'answer', option: pick(idx, (i) => ch.options[i].ops.reduce((a, o) => a + opValue(ctx, o, pr.item.src), 0)) };
    }
    case 'cards': {
      if (op.k === 'discardDraw') {
        const worst = pick(pr.cards, (id) => -cardNetValue(ctx, id));
        return { t: 'answer', cards: cardNetValue(ctx, worst) < cardDrawValue(ctx) * 0.8 ? [worst] : [] };
      }
      const ranked = pr.cards.map((id) => ({ id, v: cardNetValue(ctx, id) + jitter() })).sort((a, b) => b.v - a.v);
      if (pr.costEach) {
        const buy = ranked.filter((r) => r.v - pr.costEach > cfg.researchMargin).slice(0, pr.max).map((r) => r.id);
        return { t: 'answer', cards: buy.slice(0, Math.floor(P(s, pid).res.mc / pr.costEach)) };
      }
      const n = Math.max(pr.min, Math.min(pr.max, ranked.filter((r) => r.v > 0).length));
      return { t: 'answer', cards: ranked.slice(0, n).map((r) => r.id) };
    }
    case 'amount': {
      if (op.k === 'amount' && op.id === 'insulation') return { t: 'answer', amount: prodValue(ctx, 'mc') > prodValue(ctx, 'heat') ? pr.max : 0 };
      // power infrastructure: keep the energy our other actions want
      const p = P(s, pid);
      const keep = ['ironworks', 'steelworks', 'ore-processor', 'water-splitting-plant', 'physics-complex', 'development-center', 'martian-rails']
        .filter((id) => p.played.includes(id) && !p.usedActions.includes(id)).length ? Math.min(pr.max, 6) : 0;
      return { t: 'answer', amount: Math.max(0, pr.max - keep) };
    }
  }
  return promptAnswers(s)[0];
}

export { horizon, tagCount };
