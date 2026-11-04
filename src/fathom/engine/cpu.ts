// Fathom CPU players. Each decision tries every legal action on a copy of the game, answers its
// own follow-up choices the same way, and scores the result: points now, plus what the ocean is
// set up to produce on the dives still to come, plus what the hand can still become.
//
// Easy plays loosely (noisy judgement, the odd random move). Normal values its dive engine and the
// tide goals. Hard also looks one of its own turns ahead and minds the variable-goal bonus race.
// Choices never use Math.random: the noise comes from the game state, so a game replays exactly.
import { FISH, fishDef } from './cards';
import {
  applyActionMut, BOTTOM_BONUS, canAfford, decider, eggTargets, fryCount, goalPoints, legalSlots, MID_BONUS,
  score, top, TOP_BONUS, turnsLeft, TWI_BONUS,
} from './game';
import { COLS, DIVERS, ROWS, slotOf, type Cost, type Effect, type FAction, type FishDef, type FPlayer, type FState, type Level } from './types';

/** A copy for simulation: the log and history aren't needed and are the bulk of the state. */
export const simClone = (s: FState): FState => structuredClone({ ...s, log: [], history: [] });

const DRAW_FADE = 10;

/** Rough worth of one effect, in points, for a player with `left` turns to go. */
function effectValue(p: FPlayer, e: Effect, left: number): number {
  const fresh = Math.min(1, left / DRAW_FADE); // cards are only worth something while they can still be played
  switch (e.k) {
    case 'draw': return e.n * (0.15 + 1.0 * fresh);
    case 'egg': return Math.min(e.n, Math.max(eggTargets(p).length, 0)) * 1.05;
    case 'eggEach': return Math.min(3, eggTargets(p, e.where).length) * 1.0 + 0.3;
    case 'hatch': return p.ocean.some((x) => x.egg) ? 0.35 * e.n : 0.05;
    case 'fry': return e.n * 1.15;
    case 'move': return p.ocean.some((x) => x.fry > 0) ? 0.45 : 0.05;
    case 'recover': return 0.2 + 0.9 * fresh;
    case 'cycle': return 0.15 + 0.2 * fresh;
    case 'all': return effectValue(p, e.e, left) * 0.9;
  }
}

/** What one dive of this site would give right now (bottom bonus included if still there). */
export function diveYield(p: FPlayer, col: number, left: number): number {
  const has = (rows: number[]) => rows.some((r) => top(p.ocean[slotOf(r, col)]));
  let v = 0;
  if (has([0, 1])) v += effectValue(p, TOP_BONUS[col], left);
  if (has([2, 3])) v += effectValue(p, TWI_BONUS[col], left);
  if (has([4, 5])) v += effectValue(p, MID_BONUS[col], left);
  for (let r = 0; r < ROWS; r++) {
    const t = top(p.ocean[slotOf(r, col)]);
    for (const e of t ? fishDef(t).dive ?? [] : []) v += effectValue(p, e, left);
  }
  return v;
}

const costValue = (c: Cost) => (c.cards ?? 0) * 0.85 + (c.eggs ?? 0) * 1.05 + (c.fry ?? 0) * 1.1 + (c.eat ? 0.4 : 0);

/** How good a card is to hold: what playing it should net, given the turns left. */
export function cardPotential(p: FPlayer, d: FishDef, left: number): number {
  const dives = Math.max(0, left - 1) * 0.35;
  let v = d.pts - costValue(d.cost);
  for (const e of d.play ?? []) v += effectValue(p, e, left);
  for (const e of d.dive ?? []) v += effectValue(p, e, left) * Math.min(dives, 4) * 0.5;
  if (d.end) v += 2;
  return v;
}

interface Weights { engine: number; hand: number; goal: number; schoolSoon: number; lookahead: boolean; noise: number; randomMove: number; rival: number }
const WEIGHTS: Record<Level, Weights> = {
  easy: { engine: 0.6, hand: 0.6, goal: 0.4, schoolSoon: 0.4, lookahead: false, noise: 3.5, randomMove: 0.15, rival: 0 },
  normal: { engine: 1, hand: 1, goal: 0.85, schoolSoon: 0.9, lookahead: false, noise: 0.3, randomMove: 0, rival: 0 },
  hard: { engine: 1, hand: 1, goal: 0.9, schoolSoon: 1, lookahead: true, noise: 0, randomMove: 0, rival: 0.15 },
};

/** The position's worth to `pid`, in points. */
export function evaluate(s: FState, pid: number, level: Level): number {
  const w = WEIGHTS[level];
  const p = s.players[pid];
  let v = score(s, pid).total;
  if (s.phase === 'over') return v - w.rival * Math.max(0, ...s.players.filter((x) => x.id !== pid).map((x) => score(s, x.id).total));
  const left = Math.max(0, turnsLeft(s, pid));

  // the dive engine: about a third of the remaining turns go on dives, mostly at the best sites
  const yields = [0, 1, 2].map((c) => diveYield(p, c, left)).sort((a, b) => b - a);
  const dives = left * 0.4;
  v += w.engine * dives * (yields[0] * 0.6 + yields[1] * 0.3 + yields[2] * 0.1);
  // bottom bonuses still to take this tide
  for (let c = 0; c < COLS; c++) if (!p.bottom[c] && p.divers > 0) v += w.engine * 0.35 * BOTTOM_BONUS[c].reduce((a, e) => a + effectValue(p, e, left), 0);

  // the hand: the best few cards will get played, the rest are near-worthless late
  const plays = Math.ceil(left * 0.5);
  const pots = p.hand.map((c) => cardPotential(p, FISH[c], left)).sort((a, b) => b - a);
  v += w.hand * pots.reduce((a, x, i) => a + (i < plays ? Math.max(0.1, x) * 0.45 : 0.05), 0);
  v += p.hand.length * 0.01; // the tie-break

  // fry close to a school
  for (const x of p.ocean) if (!x.school && x.fry === 2) v += w.schoolSoon * 1.2;

  // the goal that scores at the end of this tide, weighted by how close the end is
  if (s.tide <= 3) {
    const g = s.goals[s.tide - 1];
    const near = 1 - p.divers / (DIVERS * 1.5);
    v += w.goal * goalPoints(p, g) * near;
    if (s.options.variable) {
      const best = Math.max(...s.players.filter((x) => x.id !== pid && !x.forfeited).map((x) => goalPoints(x, g)), 0);
      if (goalPoints(p, g) >= best && goalPoints(p, g) > 0) v += w.goal * 3 * near * 0.7;
    }
    // later goals: a little for progress toward them now
    for (const g2 of s.goals.slice(s.tide)) v += w.goal * 0.25 * goalPoints(p, g2);
  }
  if (w.rival) v -= w.rival * Math.max(0, ...s.players.filter((x) => x.id !== pid).map((x) => score(s, x.id).total));
  return v;
}

// ---------------------------------------------------------------- choosing

/** Cheapest way to pay for a fish: the least useful cards, eggs and fry from the fullest slots. */
export function autoPay(s: FState, pid: number, card: string, slot: number, level: Level = 'normal'): Extract<FAction, { t: 'release' }>['pay'] | null {
  const p = s.players[pid];
  const c = FISH[card].cost;
  const left = turnsLeft(s, pid);
  const others = p.hand.filter((x) => x !== card).sort((a, b) => cardPotential(p, FISH[a], left) - cardPotential(p, FISH[b], left));
  if (others.length < (c.cards ?? 0)) return null;
  const eggSlots = p.ocean.map((x, i) => (x.egg ? i : -1)).filter((i) => i >= 0);
  if (eggSlots.length < (c.eggs ?? 0)) return null;
  // prefer eggs not on the target (the new fish would keep it) and on fish whose eggs can't be re-laid easily
  eggSlots.sort((a, b) => Number(a === slot) - Number(b === slot));
  const fry: number[] = [];
  const pool = p.ocean.map((x) => x.fry);
  for (let k = 0; k < (c.fry ?? 0); k++) {
    // take from slots that aren't one fry short of a school
    let best = -1;
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i]) continue;
      if (best < 0 || (pool[best] === 2 && pool[i] !== 2) || (pool[i] !== 2 && pool[best] !== 2 && pool[i] < pool[best])) best = i;
    }
    if (best < 0) return null;
    pool[best]--;
    fry.push(best);
  }
  void level;
  return { cards: others.slice(0, c.cards ?? 0), eggs: eggSlots.slice(0, c.eggs ?? 0), fry };
}

/** Every action a CPU considers on its turn (one payment per placement). */
export function candidateActions(s: FState, pid: number, level: Level = 'normal'): FAction[] {
  const p = s.players[pid];
  const out: FAction[] = [];
  for (let col = 0; col < COLS; col++) out.push({ t: 'dive', col });
  for (const card of new Set(p.hand)) {
    if (!canAfford(p, card)) continue;
    for (const slot of legalSlots(p, card)) {
      const pay = autoPay(s, pid, card, slot, level);
      if (pay) out.push({ t: 'release', card, slot, pay });
    }
  }
  return out;
}

const stateNoise = (s: FState, salt: number) => {
  let h = (s.rng ^ Math.imul(s.turn + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Answers this player's own follow-up choices greedily until the turn hands over. */
function settle(s: FState, pid: number, level: Level): FState {
  for (let guard = 0; guard < 40 && s.phase !== 'over' && s.prompt && s.prompt.pid === pid; guard++) {
    applyActionMut(s, bestAnswer(s, level));
  }
  return s;
}

function bestAnswer(s: FState, level: Level): FAction {
  const pr = s.prompt!;
  let best: FAction = { t: 'answer', choice: null };
  let bestV = evaluate(applyCopy(s, best), pr.pid, level);
  for (let i = 0; i < pr.options.length; i++) {
    const a: FAction = { t: 'answer', choice: i };
    const v = evaluate(applyCopy(s, a), pr.pid, level);
    if (v > bestV + 1e-9) { bestV = v; best = a; }
  }
  return best;
}

function applyCopy(s: FState, a: FAction): FState {
  const c = simClone(s);
  applyActionMut(c, a);
  return c;
}

function valueAfter(s: FState, pid: number, a: FAction, level: Level): FState | null {
  try {
    const c = simClone(s);
    applyActionMut(c, a);
    return settle(c, pid, level);
  } catch { return null; }
}

/** The CPU's choice for whoever must decide now. */
export function cpuAction(s: FState, level: Level): FAction {
  const pid = decider(s);
  const w = WEIGHTS[level];
  if (s.prompt) {
    if (w.randomMove && stateNoise(s, 99) < w.randomMove) return { t: 'answer', choice: s.prompt.options.length ? Math.floor(stateNoise(s, 98) * s.prompt.options.length) : null };
    return bestAnswer(s, level);
  }
  const cands = candidateActions(s, pid, level);
  if (w.randomMove && stateNoise(s, 1) < w.randomMove) return cands[Math.floor(stateNoise(s, 2) * cands.length)];
  const scored: { a: FAction; v: number; after: FState }[] = [];
  cands.forEach((a, i) => {
    const after = valueAfter(s, pid, a, level);
    if (!after) return;
    scored.push({ a, v: evaluate(after, pid, level) + (w.noise ? (stateNoise(s, i + 11) - 0.5) * w.noise : 0), after });
  });
  scored.sort((x, y) => y.v - x.v);
  if (w.lookahead && scored.length > 1) {
    // look one of your own turns ahead for the most promising few
    for (const c of scored.slice(0, 6)) {
      const nxt = c.after;
      if (nxt.phase === 'over' || nxt.players[pid].divers <= 0) continue;
      const probe = simClone(nxt);
      probe.active = pid;
      let best = -Infinity;
      for (const a2 of candidateActions(probe, pid, level)) {
        const after2 = valueAfter(probe, pid, a2, level);
        if (after2) best = Math.max(best, evaluate(after2, pid, level));
      }
      if (best > -Infinity) c.v = c.v * 0.5 + best * 0.5;
    }
    scored.sort((x, y) => y.v - x.v);
  }
  return scored[0]?.a ?? { t: 'dive', col: 0 };
}

export { fryCount };
