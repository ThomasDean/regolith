// CPU strategy: award timing, play styles and deterministic choices.
import { describe, expect, it } from 'vitest';
import { createGame, applyAction } from '../src/engine/game';
import { cpuAction, evaluate, seatConfig } from '../src/engine/ai/cpu';
import { awardEV, styleFor } from '../src/engine/ai/value';
import type { GameState, Level } from '../src/engine/types';

function table(gen: number, temp: number, oxy: number, oceans: number, level: Level = 'normal'): GameState {
  const s = createGame([0, 1, 2].map((i) => ({ name: `P${i}`, color: '#000', cpu: level })), { seed: 11 });
  s.phase = 'action';
  s.generation = gen;
  s.temperature = temp;
  s.oxygen = oxy;
  s.oceans = oceans;
  s.active = 0;
  s.actionsThisTurn = 0;
  for (const p of s.players) {
    p.setup = undefined;
    p.corp = 'credicor';
    p.hand = [];
    p.res.mc = 40;
    p.prod.mc = 2;
  }
  return s;
}

/** Change in the CPU's own evaluation from funding an award now. */
function fundingGain(s: GameState, id: string, level: Level = 'normal'): number {
  const cfg = seatConfig(s, 0, level);
  return evaluate(applyAction(s, { t: 'award', id }), 0, cfg) - evaluate(s, 0, cfg);
}

describe('award funding', () => {
  it('does not fund a small early lead', () => {
    const s = table(2, -28, 1, 1);
    s.players[0].prod.mc = 4; // narrowly ahead on Banker
    expect(fundingGain(s, 'banker')).toBeLessThan(0);
  });

  it('funds a safe lead near the end', () => {
    const s = table(11, 4, 12, 8);
    s.players[0].prod.mc = 14;
    expect(fundingGain(s, 'banker')).toBeGreaterThan(0);
  });

  it('never funds an award it is losing', () => {
    const s = table(11, 4, 12, 8);
    s.players[1].prod.mc = 14;
    expect(fundingGain(s, 'banker')).toBeLessThan(0);
  });

  it('expected award points grow with the margin and shrink with time left', () => {
    const s = table(6, -10, 5, 4);
    s.players[0].prod.mc = 6;
    const near = awardEV(s, 'banker', 2)[0];
    const far = awardEV(s, 'banker', 8)[0];
    s.players[0].prod.mc = 10;
    const wide = awardEV(s, 'banker', 8)[0];
    expect(near).toBeGreaterThan(far);
    expect(wide).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(5);
  });

  it('expected award points add up to the prize pool', () => {
    const s = table(6, -10, 5, 4);
    s.players[0].prod.mc = 5;
    s.players[1].prod.mc = 3;
    const total = awardEV(s, 'banker', 4).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(6.5);
    expect(total).toBeLessThan(7.5);
  });
});

describe('play styles', () => {
  it('are fixed by the seed and seat', () => {
    expect(styleFor(42, 1, 1)).toEqual(styleFor(42, 1, 1));
    const names = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) for (let pid = 0; pid < 3; pid++) names.add(styleFor(seed, pid, 1).name);
    expect(names.size).toBeGreaterThanOrEqual(3);
  });

  it('stay close to neutral', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const st = styleFor(seed, 0, 1.3);
      for (const k of ['prod', 'tr', 'tiles', 'cards'] as const) {
        expect(st[k]).toBeGreaterThan(0.8);
        expect(st[k]).toBeLessThan(1.25);
      }
    }
  });
});

describe('determinism', () => {
  it('picks the same move from the same state without an explicit random source', () => {
    for (const level of ['easy', 'normal', 'hard'] as Level[]) {
      const s = createGame([0, 1, 2].map((i) => ({ name: `P${i}`, color: '#000', cpu: level })), { seed: 7 });
      let x = s;
      for (let i = 0; i < 12 && x.phase !== 'over'; i++) {
        const a = cpuAction(x, level);
        expect(cpuAction(structuredClone(x), level)).toEqual(a);
        x = applyAction(x, a);
      }
    }
  }, 60000);
});
