import { describe, it, expect } from 'vitest';
import { applyAction, createGame } from '../src/engine/game';
import { availableSpaces, cardCost, checkPayment, requirementsMet, score, awardPlaces } from '../src/engine/queries';
import { neighbours } from '../src/engine/board';
import type { GameState } from '../src/engine/types';

/** A 2- or 3-player game already in the action phase with chosen corporations. */
function ready(corps: string[], seed = 1): GameState {
  let s = createGame(corps.map((_, i) => ({ name: `P${i}`, color: '#000', cpu: null })), { seed });
  while (s.phase === 'setup') {
    const p = s.players[s.active];
    s = applyAction(s, { t: 'setup', corp: p.setup!.corps[0], keep: [] });
  }
  // finish any corporation first action prompts
  while (s.prompt) s = applyAction(s, { t: 'answer', space: (s.prompt as { options: string[] }).options[0] });
  s = structuredClone(s);
  s.players.forEach((p, i) => {
    p.corp = corps[i];
    p.firstActionDone = true;
    p.res = { mc: 100, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 };
    p.prod = { mc: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 };
    p.hand = [];
  });
  for (const sp of s.board) { delete sp.tile; delete sp.claimedBy; }
  s.temperature = -30; s.oxygen = 0; s.oceans = 0;
  s.active = 0; s.actionsThisTurn = 0;
  return s;
}

describe('setup', () => {
  it('charges 3 M€ per kept card and applies the corporation', () => {
    let s = createGame([{ name: 'A', color: '#000', cpu: null }, { name: 'B', color: '#000', cpu: null }], { seed: 3 });
    const p = s.players[s.active];
    const corp = p.setup!.corps[0];
    const keep = p.setup!.cards.slice(0, 3);
    s = applyAction(s, { t: 'setup', corp, keep });
    const q = s.players.find((x) => x.corp === corp)!;
    expect(q.hand).toEqual(keep);
    expect(q.res.mc).toBeLessThanOrEqual(60 - 9);
  });
  it('lets the beginner corporation keep all 10 cards for free', () => {
    let s = createGame([{ name: 'A', color: '#000', cpu: null }, { name: 'B', color: '#000', cpu: null }], { seed: 4 });
    s = applyAction(s, { t: 'setup', corp: 'beginner-corporation', keep: [] });
    const q = s.players.find((x) => x.corp === 'beginner-corporation')!;
    expect(q.hand.length).toBe(10);
    expect(q.res.mc).toBe(42);
  });
});

describe('global parameters', () => {
  it('raising temperature to -24 and -20 adds heat production', () => {
    let s = ready(['credicor', 'helion']);
    s.players[0].res.heat = 24;
    for (let i = 0; i < 3; i++) {
      s = applyAction(s, { t: 'heat' });
      if (s.active !== 0) s.active = 0, s.actionsThisTurn = 0;
    }
    expect(s.temperature).toBe(-24);
    expect(s.players[0].prod.heat).toBe(1);
    expect(s.players[0].tr).toBe(23);
  });
  it('raising temperature to 0 places an ocean', () => {
    let s = ready(['credicor', 'helion']);
    s.temperature = -2;
    s.players[0].res.heat = 8;
    s = applyAction(s, { t: 'heat' });
    expect(s.prompt?.kind).toBe('space');
    s = applyAction(s, { t: 'answer', space: (s.prompt as { options: string[] }).options[0] });
    expect(s.oceans).toBe(1);
    expect(s.players[0].tr).toBe(22);
  });
  it('oxygen reaching 8% raises temperature', () => {
    let s = ready(['credicor', 'helion']);
    s.oxygen = 7;
    s.players[0].res.plants = 8;
    s = applyAction(s, { t: 'plants' });
    s = applyAction(s, { t: 'answer', space: (s.prompt as { options: string[] }).options[0] });
    expect(s.oxygen).toBe(8);
    expect(s.temperature).toBe(-28);
  });
});

describe('placement', () => {
  it('pays 2 M€ per adjacent ocean', () => {
    let s = ready(['ecoline', 'helion']);
    s.players[0].hand = ['ice-asteroid'];
    s.players[0].res.mc = 23;
    s = applyAction(s, { t: 'play', card: 'ice-asteroid' });
    const first = '08'; // an ocean area; pick a neighbouring ocean area next
    const options = (s.prompt as { options: string[] }).options;
    const a = options.find((x) => neighbours(s.board, x).some((n) => n.type === 'ocean' && options.includes(n.id)))!;
    void first;
    s = applyAction(s, { t: 'answer', space: a });
    const b = neighbours(s.board, a).find((n) => n.type === 'ocean' && !n.tile)!.id;
    const before = s.players[0].res.mc;
    const bonusMc = 0;
    s = applyAction(s, { t: 'answer', space: b });
    expect(s.players[0].res.mc - before - bonusMc).toBe(2);
  });
  it('requires greeneries next to your own tiles when possible', () => {
    const s = ready(['credicor', 'helion']);
    s.board.find((x) => x.id === '32')!.tile = { kind: 'city', owner: 0 };
    const opts = availableSpaces(s, 0, 'greenery', 'greenery');
    expect(opts.length).toBeGreaterThan(0);
    for (const id of opts) expect(neighbours(s.board, id).some((n) => n.id === '32')).toBe(true);
  });
  it('forbids cities next to cities', () => {
    const s = ready(['credicor', 'helion']);
    s.board.find((x) => x.id === '32')!.tile = { kind: 'city', owner: 1 };
    const opts = availableSpaces(s, 0, 'city', 'city');
    for (const n of neighbours(s.board, '32')) expect(opts).not.toContain(n.id);
  });
});

describe('cards and payment', () => {
  it('applies tag discounts', () => {
    const s = ready(['teractor', 'helion']);
    s.players[0].played = ['earth-office'];
    expect(cardCost(s, 0, 'acquired-company')).toBe(10 - 6);
  });
  it('applies requirement bonuses', () => {
    const s = ready(['inventrix', 'helion']);
    s.temperature = -16; // Bushes needs -10; Inventrix allows 2 steps (4°C) of slack
    expect(requirementsMet(s, 0, 'bushes')).toBe(false);
    s.temperature = -14;
    expect(requirementsMet(s, 0, 'bushes')).toBe(true);
  });
  it('accepts steel only on building cards and rejects waste', () => {
    const s = ready(['credicor', 'helion']);
    s.players[0].res.steel = 10;
    expect(checkPayment(s, 0, 10, { steel: 5 }, { steel: true, titanium: false, heat: false })).toBe(0);
    expect(checkPayment(s, 0, 10, { steel: 6 }, { steel: true, titanium: false, heat: false })).toBeNull();
    expect(checkPayment(s, 0, 10, { steel: 2 }, { steel: false, titanium: false, heat: false })).toBeNull();
  });
  it('triggers Tharsis Republic on cities', () => {
    let s = ready(['tharsis-republic', 'helion']);
    s.players[0].res.mc = 25;
    s = applyAction(s, { t: 'sp', id: 'city' });
    s = applyAction(s, { t: 'answer', space: (s.prompt as { options: string[] }).options[0] });
    expect(s.players[0].prod.mc).toBe(2); // +1 city project, +1 Tharsis
    expect(s.players[0].res.mc).toBeGreaterThanOrEqual(3);
  });
  it('Protected Habitats shields plants from opponents', () => {
    let s = ready(['credicor', 'helion']);
    s.players[1].played = ['protected-habitats'];
    s.players[1].res.plants = 5;
    s.players[0].hand = ['asteroid'];
    s = applyAction(s, { t: 'play', card: 'asteroid' });
    // no plant-removal prompt targets the protected player
    while (s.prompt) {
      if (s.prompt.kind === 'player') expect(s.prompt.options).not.toContain(1);
      s = applyAction(s, s.prompt.kind === 'player' ? { t: 'answer', player: null } : { t: 'answer', space: (s.prompt as { options: string[] }).options[0] });
    }
    expect(s.players[1].res.plants).toBe(5);
  });
});

describe('milestones, awards and scoring', () => {
  it('limits milestones to three', () => {
    let s = ready(['credicor', 'helion']);
    s.milestones = [{ id: 'mayor', pid: 1 }, { id: 'gardener', pid: 1 }, { id: 'builder', pid: 1 }];
    s.players[0].tr = 35;
    expect(() => applyAction(s, { t: 'milestone', id: 'terraformer' })).toThrow();
    s.milestones.pop();
    s = applyAction(s, { t: 'milestone', id: 'terraformer' });
    expect(s.players[0].res.mc).toBe(92);
    expect(score(s, 0).milestones).toBe(5);
  });
  it('awards 5 and 2 points, no second place with two players', () => {
    const s3 = ready(['credicor', 'helion', 'ecoline']);
    s3.awards = [{ id: 'thermalist', pid: 0 }];
    s3.players[0].res.heat = 10; s3.players[1].res.heat = 6; s3.players[2].res.heat = 1;
    expect(awardPlaces(s3, 'thermalist')).toEqual({ first: [0], second: [1] });
    const s2 = ready(['credicor', 'helion']);
    s2.players[0].res.heat = 10; s2.players[1].res.heat = 6;
    expect(awardPlaces(s2, 'thermalist').second).toEqual([]);
  });
  it('scores greeneries and city adjacency', () => {
    const s = ready(['credicor', 'helion']);
    s.board.find((x) => x.id === '32')!.tile = { kind: 'city', owner: 0 };
    const [a, b] = neighbours(s.board, '32').filter((n) => n.type === 'land');
    a.tile = { kind: 'greenery', owner: 0 };
    b.tile = { kind: 'greenery', owner: 1 };
    const sc = score(s, 0);
    expect(sc.greeneries).toBe(1);
    expect(sc.cities).toBe(2);
  });
});

describe('generations', () => {
  it('runs production: energy becomes heat, M€ = TR + production', () => {
    let s = ready(['credicor', 'helion']);
    s.players[0].res.energy = 3; s.players[0].prod.mc = 2;
    s = applyAction(s, { t: 'pass' });
    s = applyAction(s, { t: 'pass' });
    expect(s.phase).toBe('research');
    expect(s.players[0].res.heat).toBe(3);
    expect(s.players[0].res.mc).toBe(100 + 20 + 2);
    expect(s.players[0].research?.length).toBe(4);
  });
  it('ends with a final greenery round once Mars is terraformed', () => {
    let s = ready(['credicor', 'helion']);
    s.temperature = 8; s.oxygen = 14; s.oceans = 9;
    s.players[1].res.plants = 8;
    s = applyAction(s, { t: 'pass' });
    s = applyAction(s, { t: 'pass' });
    expect(s.phase).toBe('finalGreenery');
    while (s.phase === 'finalGreenery') {
      const p = s.players[s.active];
      if (p.res.plants >= 8) {
        s = applyAction(s, { t: 'plants' });
        s = applyAction(s, { t: 'answer', space: (s.prompt as { options: string[] }).options[0] });
      } else s = applyAction(s, { t: 'pass' });
    }
    expect(s.phase).toBe('over');
    expect(score(s, 1).greeneries).toBe(1);
    expect(s.oxygen).toBe(14);
  });
  it('replays exactly from seed and actions', () => {
    const run = () => {
      let s = createGame([{ name: 'A', color: '#000', cpu: null }, { name: 'B', color: '#000', cpu: null }], { seed: 77 });
      const acts: unknown[] = [];
      while (s.phase === 'setup') { const a = { t: 'setup' as const, corp: s.players[s.active].setup!.corps[0], keep: s.players[s.active].setup!.cards.slice(0, 2) }; acts.push(a); s = applyAction(s, a); }
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
