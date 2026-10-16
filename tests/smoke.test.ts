import { describe, it, expect } from 'vitest';
import { createGame, applyAction } from '../src/engine/game';
import { randomAction } from '../src/engine/bot';
import { score } from '../src/engine/queries';

function rng(seed: number) { let t = seed; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

describe('random games', () => {
  for (let g = 0; g < 12; g++) {
    it(`finishes random game ${g}`, () => {
      const n = 2 + (g % 3);
      let s = createGame(Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', cpu: null })), { seed: 1000 + g, corporateEra: g % 4 !== 3 });
      const r = rng(g + 7);
      let steps = 0;
      while (s.phase !== 'over' && steps < 40000) { s = applyAction(s, randomAction(s, r)); steps++; }
      expect(s.phase).toBe('over');
      for (const p of s.players) expect(score(s, p.id).total).toBeGreaterThan(0);
    });
  }
});
