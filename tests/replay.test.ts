// The detailed log records what every step changed; the catch-up replay undoes those records to
// rebuild earlier tables. Check the rebuilt tables match the real earlier states.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import type { GameState } from '../src/engine/types';
import { buildReplay } from '../src/ui/replay';

const visible = (s: GameState) => ({
  players: s.players.map((p) => ({
    res: p.res, prod: p.prod, tr: p.tr, played: p.played, corp: p.corp, passed: p.passed,
    cardRes: Object.fromEntries(Object.entries(p.cardRes).filter(([, n]) => n)),
  })),
  tiles: s.board.filter((x) => x.tile).map((x) => x.id).sort(),
  temp: s.temperature, oxy: s.oxygen, oceans: s.oceans, venus: s.venus,
  milestones: s.milestones, awards: s.awards, gen: s.generation, phase: s.phase,
});

describe('log effects and replay', () => {
  for (const seed of [3, 11]) {
    it(`rebuilds earlier tables exactly (seed ${seed})`, { timeout: 60000 }, () => {
      let s = createGame(['A', 'B', 'C'].map((name, i) => ({ name, color: '#000', cpu: (['normal', 'hard', 'easy'] as const)[i] })),
        { seed, expansions: seed === 11 ? { venus: true, prelude: true } : {} });
      const states: GameState[] = [s];
      // stay under the log's 400-entry cap so every entry is still there
      while (s.phase !== 'over' && s.log.length < 380) {
        const d = s.prompt ? s.prompt.pid : s.active;
        s = applyAction(s, cpuAction(s, s.players[d].cpu!));
        states.push(s);
      }
      expect(s.log.filter((l) => l.fx).length).toBeGreaterThan(50);
      for (const old of states.filter((_, i) => i % 7 === 0)) {
        const r = buildReplay(s, old.log.length);
        expect(visible(r.frames[0])).toEqual(visible(old));
        expect(visible(r.frames[r.frames.length - 1])).toEqual(visible(s));
      }
    });
  }

});
