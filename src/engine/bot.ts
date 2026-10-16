// Random-move agent for fuzzing whole games. It leans away from passing so games finish.
import type { Action, GameState } from './types';
import { legalActions } from './moves';

export function randomAction(s: GameState, rnd: () => number): Action {
  const acts = legalActions(s);
  if (!acts.length) throw new Error('No legal actions');
  if (!s.prompt && s.phase === 'action') {
    const busy = acts.filter((a) => a.t !== 'pass' && a.t !== 'endTurn' && !(a.t === 'sp' && a.id === 'sell'));
    if (busy.length && rnd() < 0.9) return busy[Math.floor(rnd() * busy.length)];
  }
  if (s.phase === 'finalGreenery' && acts[0].t === 'plants') return acts[0];
  return acts[Math.floor(rnd() * acts.length)];
}
