// Premoves: queued passes and card actions are made when the player's turn comes.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import { premovesOf, runPremoves, setPremoves } from '../src/engine/premoves';
import { viewFor } from '../src/online/referee';
import type { GameState } from '../src/engine/types';

const decider = (s: GameState) => (s.prompt ? s.prompt.pid : s.active);

/** CPUs play every seat except 0 (which also plays as a CPU until `until` says stop). */
function playUntil(s: GameState, until: (s: GameState) => boolean, limit = 3000): GameState {
  for (let i = 0; i < limit && !until(s) && s.phase !== 'over'; i++) {
    const d = decider(s);
    s = applyAction(s, cpuAction(s, s.players[d].cpu ?? 'normal'));
    runPremoves(s);
  }
  return s;
}

const game = (seed: number) => createGame([{ name: 'Me', color: '#e4574a', cpu: null }, { name: 'B', color: '#4a9fe4', cpu: 'normal' }, { name: 'C', color: '#5fc07a', cpu: 'normal' }], { seed });

describe('premoves', () => {
  it('passes for you when your turn comes', () => {
    // get to an action phase where someone else is up
    let s = playUntil(game(4), (x) => x.phase === 'action' && x.generation >= 2 && decider(x) !== 0 && !x.players[0].passed);
    setPremoves(s, 0, [{ t: 'pass' }]);
    expect(premovesOf(s, 0)).toEqual([{ t: 'pass' }]);
    const gen = s.generation;
    s = playUntil(s, (x) => x.players[0].passed || x.generation !== gen);
    expect(s.players[0].passed).toBe(true);
    expect(s.log.some((l) => l.pid === 0 && /passed/.test(l.text))).toBe(true);
    expect(premovesOf(s, 0)).toEqual([]);
  });

  it('skips card actions that can no longer be used, and drops queues from earlier generations', () => {
    let s = playUntil(game(7), (x) => x.phase === 'action' && decider(x) === 0 && x.actionsThisTurn === 0);
    // a card nobody has in play can't be used: skipped, nothing happens
    setPremoves(s, 0, [{ t: 'cardAction', card: 'birds' }]);
    const before = JSON.stringify(s.players[0].res);
    expect(runPremoves(s)).toEqual([]);
    expect(JSON.stringify(s.players[0].res)).toBe(before);
    expect(premovesOf(s, 0)).toEqual([]);
    // a queue from an earlier generation is ignored
    s.premoves = { 0: { gen: s.generation - 1, list: [{ t: 'pass' }] } };
    expect(premovesOf(s, 0)).toEqual([]);
    expect(runPremoves(s)).toEqual([]);
    expect(s.players[0].passed).toBe(false);
  });

  it('rejects bad lists and cuts everything after a pass', () => {
    const s = game(1);
    expect(() => setPremoves(s, 0, [{ t: 'play', card: 'birds' }])).toThrow();
    expect(() => setPremoves(s, 0, 'pass')).toThrow();
    setPremoves(s, 0, [{ t: 'pass' }, { t: 'cardAction', card: 'birds' }]);
    expect(premovesOf(s, 0)).toEqual([{ t: 'pass' }]);
    setPremoves(s, 0, []);
    expect(premovesOf(s, 0)).toEqual([]);
  });

  it('shows each seat only its own queue online', () => {
    const s = game(2);
    setPremoves(s, 0, [{ t: 'pass' }]);
    setPremoves(s, 1, [{ t: 'pass' }]);
    expect(Object.keys(viewFor(s, 0).premoves ?? {})).toEqual(['0']);
    expect(viewFor(s, 2).premoves).toBeUndefined();
  });
});
