import { it, expect } from 'vitest';
import { createGame, applyAction } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import { score } from '../src/engine/queries';
import type { Level } from '../src/engine/types';

function rng(seed: number) { let t = seed; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

export function playGame(levels: Level[], seed: number) {
  let s = createGame(levels.map((l, i) => ({ name: `${l}${i}`, color: '#000', cpu: l })), { seed });
  const r = rng(seed);
  let steps = 0;
  const t0 = Date.now();
  while (s.phase !== 'over' && steps < 20000) {
    const pid = s.prompt ? s.prompt.pid : s.active;
    s = applyAction(s, cpuAction(s, s.players[pid].cpu!, r));
    steps++;
  }
  return { s, steps, ms: Date.now() - t0 };
}

it('normal CPUs finish a 3-player game', () => {
  const { s, steps, ms } = playGame(['normal', 'normal', 'normal'], 42);
  console.log('gens', s.generation, 'steps', steps, 'ms', ms, s.players.map((p) => [p.corp, score(s, p.id).total, p.played.length]));
  expect(s.phase).toBe('over');
}, 300000);
