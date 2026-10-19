// Shared helpers for the benchmarking scripts: run a seeded CPU game with a named agent per seat.
// Agent names are a difficulty ('easy' | 'normal' | 'hard') or 'old-<level>' for the frozen
// pre-rework evaluator in scripts/baseline/ (used for before/after comparisons).
import { createGame, applyAction } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import { cpuAction as oldCpuAction } from './baseline/cpu';
import type { Action, GameState, Level } from '../src/engine/types';

export type Agent = string;
export const levelOf = (a: Agent): Level => a.replace(/^old-/, '') as Level;
export const decide = (a: Agent, s: GameState, rnd: () => number): Action =>
  a.startsWith('old-') ? oldCpuAction(s, levelOf(a), rnd) : cpuAction(s, levelOf(a), rnd);

export function lcg(seed: number) {
  let v = seed;
  return () => { v = (v * 16807) % 2147483647; return v / 2147483647; };
}

/**
 * Play one game. Seats rotate with the game number so no agent always sits first.
 * `onAction` sees every decision before it is applied.
 */
export function playSeeded(agents: Agent[], g: number, onAction?: (s: GameState, pid: number, a: Action, seat: Agent[]) => void, maxSteps = 6000) {
  const R = lcg(g * 7919 + 3);
  const seat = agents.map((_, i) => agents[(i + g) % agents.length]);
  let s = createGame(seat.map((l, i) => ({ name: `${l}${i}`, color: '#000', cpu: levelOf(l) })), { seed: g });
  let n = 0;
  while (s.phase !== 'over' && n < maxSteps) {
    const pid = s.prompt ? s.prompt.pid : s.active;
    const a = decide(seat[pid], s, R);
    onAction?.(s, pid, a, seat);
    s = applyAction(s, a);
    n++;
  }
  return { s, seat, steps: n };
}
