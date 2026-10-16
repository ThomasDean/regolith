// The CPU's valuation should notice cards that build on each other.
import { describe, expect, it } from 'vitest';
import { createGame } from '../src/engine/game';
import { LEVELS } from '../src/engine/ai/cpu';
import { cardNetValue, makeCtx, prodValue, resValue, type Ctx } from '../src/engine/ai/value';
import type { GameState } from '../src/engine/types';

function midGame(): GameState {
  const s = createGame([{ name: 'A', color: '#000', cpu: 'hard' }, { name: 'B', color: '#000', cpu: 'hard' }], { seed: 5 });
  s.phase = 'action';
  s.generation = 4;
  s.temperature = -16;
  s.oxygen = 4;
  s.oceans = 3;
  for (const p of s.players) {
    p.setup = undefined;
    p.corp = 'credicor';
    p.hand = [];
    p.res.mc = 40;
  }
  return s;
}

const ctxFor = (s: GameState, level: 'easy' | 'hard', future = true): Ctx => ({ ...makeCtx(s, 0, LEVELS[level].weights), future });

describe('CPU synergy valuation', () => {
  it('values an accumulator more when a feeder is already in play', () => {
    const s = midGame();
    s.players[0].hand = ['tardigrades'];
    const alone = cardNetValue(ctxFor(s, 'hard'), 'tardigrades');
    s.players[0].played = ['symbiotic-fungus'];
    const fed = cardNetValue(ctxFor(s, 'hard'), 'tardigrades');
    expect(fed).toBeGreaterThan(alone + 1);
  });

  it('values a one-off feeder more when it holds a matching target', () => {
    const s = midGame();
    s.players[0].hand = ['large-convoy'];
    const alone = cardNetValue(ctxFor(s, 'hard'), 'large-convoy');
    s.players[0].hand = ['large-convoy', 'birds'];
    const paired = cardNetValue(ctxFor(s, 'hard'), 'large-convoy');
    expect(paired).toBeGreaterThan(alone);
  });

  it('values energy production more when holding energy-hungry actions', () => {
    const s = midGame();
    const plain = prodValue(ctxFor(s, 'hard'), 'energy');
    s.players[0].hand = ['steelworks', 'ironworks'];
    expect(prodValue(ctxFor(s, 'hard'), 'energy')).toBeGreaterThan(plain);
  });

  it('values steel more when holding a steel sink', () => {
    const s = midGame();
    const plain = resValue(ctxFor(s, 'hard'), 'steel');
    s.players[0].hand = ['space-elevator'];
    expect(resValue(ctxFor(s, 'hard'), 'steel')).toBeGreaterThan(plain);
  });

  it('easy CPUs ignore these pairings', () => {
    const s = midGame();
    s.players[0].hand = ['tardigrades'];
    const alone = cardNetValue(ctxFor(s, 'easy'), 'tardigrades');
    s.players[0].played = ['symbiotic-fungus'];
    expect(cardNetValue(ctxFor(s, 'easy'), 'tardigrades')).toBeCloseTo(alone, 5);
  });
});
