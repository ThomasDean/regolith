import { it, expect } from 'vitest';
import { createGame, applyAction } from '../src/engine/game';
import { randomAction } from '../src/engine/bot';
import { CARDS, PRELUDE_IDS, PROJECT_IDS } from '../src/engine/cards';
import { RESOURCES } from '../src/engine/types';

function rng(seed: number) { let t = seed; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

it('plays every card and keeps invariants over many random games', () => {
  const played = new Set<string>(), acted = new Set<string>(), corps = new Set<string>();
  const gens: number[] = [];
  for (let g = 0; g < 150; g++) {
    let s = createGame([0, 1, 2].map((i) => ({ name: `P${i}`, color: '#000', cpu: null })), { seed: 5000 + g });
    const r = rng(g * 13 + 1);
    let steps = 0;
    while (s.phase !== 'over' && steps < 40000) {
      const a = randomAction(s, r);
      if (a.t === 'play') played.add(a.card);
      if (a.t === 'cardAction') acted.add(a.card);
      s = applyAction(s, a);
      steps++;
      for (const p of s.players) for (const k of RESOURCES) { expect(p.res[k]).toBeGreaterThanOrEqual(0); expect(p.prod[k]).toBeGreaterThanOrEqual(k === 'mc' ? -5 : 0); }
    }
    expect(s.phase).toBe('over');
    expect(s.temperature).toBe(8); expect(s.oxygen).toBe(14); expect(s.oceans).toBe(9);
    expect(s.board.filter((x) => x.tile?.kind === 'ocean').length).toBe(9);
    s.players.forEach((p) => corps.add(p.corp!));
    gens.push(s.generation);
  }
  const missing = PROJECT_IDS.filter((id) => (CARDS[id].set === 'base' || CARDS[id].set === 'corp') && !played.has(id));
  const withActions = Object.values(CARDS).filter((c) => c.action).map((c) => c.id).filter((id) => !acted.has(id));
  console.log('never played:', missing, '\nactions never used:', withActions, '\ncorps:', corps.size, 'avg gens', gens.reduce((a, b) => a + b) / gens.length);
  expect(missing.length).toBeLessThan(5);
}, 600000);

it('plays every expansion card over random games with all four expansions', () => {
  const played = new Set<string>();
  for (let g = 0; g < 60; g++) {
    let s = createGame([0, 1, 2, 3].slice(0, 2 + (g % 3)).map((i) => ({ name: `P${i}`, color: '#000', cpu: null })), { seed: 9000 + g, expansions: { prelude: true, venus: true, colonies: true, turmoil: true } });
    const r = rng(g * 31 + 5);
    let steps = 0;
    while (s.phase !== 'over' && steps < 60000) {
      const a = randomAction(s, r);
      if (a.t === 'play' || a.t === 'prelude') played.add(a.card);
      s = applyAction(s, a);
      steps++;
    }
    expect(s.phase).toBe('over');
  }
  const pool = [...PROJECT_IDS, ...PRELUDE_IDS].filter((id) => !['base', 'corp'].includes(CARDS[id].set));
  const missing = pool.filter((id) => !played.has(id));
  console.log('expansion cards never played:', missing);
  expect(missing.length).toBeLessThan(8);
}, 600000);
