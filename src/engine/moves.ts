// Legal move enumeration, used by the CPU players, the fuzz tests and the UI.
import type { Action, GameState } from './types';
import { PARTIES } from './types';
import { maxOxy, maxTemp } from './board';
import { gameAwards, gameMilestones } from './ma';
import { CARDS } from './cards';
import { P } from './helpers';
import {
  autoPay, availableSpaces, awardCost, canClaimMilestone, canFundAward, canPlayCard, canSP, cardActionAvailable,
  cardCost, greeneryCost, payLimitsForCard, activeCards, redsTax, spList,
} from './queries';
import { heatAvailable } from './game';
import { canTrade, coloniesInPlay } from './colonies';
import { PARTY_DEFS, T, delegateCost } from './turmoil';

export function subsets<T>(items: T[], min: number, max: number, limit = 64): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (out.length >= limit) return;
    if (acc.length >= min && acc.length <= max) out.push([...acc]);
    if (acc.length === max) return;
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

/** Turn-level actions available to the active player (no prompt open). */
export function turnActions(s: GameState): Action[] {
  const pid = s.active;
  const p = P(s, pid);
  const out: Action[] = [];
  for (const id of p.hand) {
    if (!canPlayCard(s, pid, id)) continue;
    const pay = autoPay(s, pid, cardCost(s, pid, id), payLimitsForCard(s, pid, id));
    if (pay) out.push({ t: 'play', card: id, pay });
  }
  for (const c of activeCards(s, pid)) if (c.action && cardActionAvailable(s, pid, c.id)) out.push({ t: 'cardAction', card: c.id });
  for (const id of spList(s)) if (canSP(s, pid, id)) out.push({ t: 'sp', id });
  if (p.hand.length) out.push({ t: 'sp', id: 'sell', cards: [p.hand[0]] });
  for (const m of gameMilestones(s)) if (canClaimMilestone(s, pid, m.id)) out.push({ t: 'milestone', id: m.id });
  if (awardCost(s) < Infinity) for (const a of gameAwards(s)) if (canFundAward(s, pid, a.id)) out.push({ t: 'award', id: a.id });
  if (p.res.plants >= greeneryCost(s, pid) && availableSpaces(s, pid, 'greenery', 'greenery').length && p.res.mc >= redsTax(s, s.oxygen < maxOxy(s) ? 1 : 0)) out.push({ t: 'plants' });
  if (heatAvailable(s, pid) >= 8 && s.temperature < maxTemp(s) && p.res.mc >= redsTax(s, 1)) out.push({ t: 'heat' });
  for (const c of coloniesInPlay(s)) {
    // the cheapest way to pay: energy, then titanium, then M€
    const pay = (['energy', 'titanium', 'mc'] as const).find((k) => canTrade(s, pid, c.id, k));
    if (pay) out.push({ t: 'trade', colony: c.id, pay });
  }
  if (s.turmoil && T(s).reserve[pid] > 0 && p.res.mc >= delegateCost(s, pid)) for (const party of PARTIES) out.push({ t: 'delegate', party });
  const pol = s.turmoil ? PARTY_DEFS[T(s).ruling].policyAction : undefined;
  if (pol && !(pol.once && p.policyUsed) && p.res.mc >= pol.cost) out.push({ t: 'policy' });
  if (s.actionsThisTurn >= 1) out.push({ t: 'endTurn' });
  out.push({ t: 'pass' });
  return out;
}

export function promptAnswers(s: GameState): Action[] {
  const pr = s.prompt!;
  switch (pr.kind) {
    case 'space': return pr.options.map((space) => ({ t: 'answer', space }));
    case 'player': return [...pr.options.map((player): Action => ({ t: 'answer', player })), ...(pr.optional ? [{ t: 'answer', player: null } as Action] : [])];
    case 'card': return [...pr.options.map((card): Action => ({ t: 'answer', card })), ...(pr.optional ? [{ t: 'answer', card: null } as Action] : [])];
    case 'choice': return pr.options.map((o, i) => (o.ok ? ({ t: 'answer', option: i } as Action) : null)).filter((x): x is Action => !!x);
    case 'cards': {
      const afford = pr.costEach ? Math.floor(P(s, pr.pid).res.mc / pr.costEach) : pr.max;
      return subsets(pr.cards, pr.min, Math.min(pr.max, afford)).map((cards) => ({ t: 'answer', cards }));
    }
    case 'amount': return Array.from({ length: pr.max + 1 }, (_, amount) => ({ t: 'answer', amount }));
  }
}

/** Every legal action for whoever must act now. Setup lists a small sample of card picks. */
export function legalActions(s: GameState): Action[] {
  if (s.phase === 'over') return [];
  if (s.prompt) return promptAnswers(s);
  const p = P(s, s.active);
  if (s.phase === 'setup') {
    const su = p.setup!;
    const out: Action[] = [];
    const pre = su.preludes ? subsets(su.preludes, 2, 2) : [undefined];
    for (const corp of su.corps) {
      const mc = CARDS[corp].startMC!;
      const price = corp === 'polyphemos' ? 5 : corp === 'terralabs-research' ? 1 : 3;
      for (let n = 0; n <= Math.min(10, Math.floor(mc / price)); n += 2) {
        for (const preludes of pre) out.push({ t: 'setup', corp, keep: su.cards.slice(0, n), ...(preludes ? { preludes } : {}) });
      }
    }
    return out;
  }
  if (s.phase === 'prelude') return (p.preludes ?? []).map((card): Action => ({ t: 'prelude', card }));
  if (s.phase === 'research') {
    const offer = p.research ?? [];
    const price = p.corp === 'polyphemos' ? 5 : p.corp === 'terralabs-research' ? 1 : 3;
    return subsets(offer, 0, Math.min(offer.length, Math.floor(p.res.mc / price))).map((keep) => ({ t: 'research', keep }));
  }
  if (s.phase === 'finalGreenery') {
    const out: Action[] = [{ t: 'pass' }];
    if (p.res.plants >= greeneryCost(s, p.id) && availableSpaces(s, p.id, 'greenery', 'greenery').length) out.unshift({ t: 'plants' });
    return out;
  }
  return turnActions(s);
}

/** Who must make the next decision. */
export const decider = (s: GameState) => (s.prompt ? s.prompt.pid : s.active);
