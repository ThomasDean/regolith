import { describe, it, expect } from 'vitest';
import { applyAction, createGame } from '../src/engine/game';
import { availableSpaces, canClaimMilestone, score } from '../src/engine/queries';
import { BOARD_IDS, BOARDS, createBoard, neighbours, type BoardId } from '../src/engine/board';
import { AWARDS, BALANCED, MILESTONES, availability, boardMA, conflict, drawMA, gameMilestones, selectionIssues, setupRandom } from '../src/engine/ma';
import { randomAction } from '../src/engine/bot';
import { cpuAction } from '../src/engine/ai/cpu';
import type { GameState } from '../src/engine/types';

function rng(seed: number) { let t = seed; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

/** Two players in the action phase on a map, with an empty board and 100 M€ each. */
function ready(board: BoardId, seed = 1): GameState {
  let s = createGame([{ name: 'A', color: '#000', cpu: null }, { name: 'B', color: '#000', cpu: null }], { seed, board });
  while (s.phase === 'setup') s = applyAction(s, { t: 'setup', corp: 'beginner-corporation', keep: [] });
  s = structuredClone(s);
  for (const p of s.players) {
    p.corp = 'beginner-corporation';
    p.firstActionDone = true;
    p.res = { mc: 100, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 };
    p.prod = { mc: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 };
    p.hand = [];
  }
  s.active = 0; s.actionsThisTurn = 0;
  return s;
}

/** Converts plants into a greenery on the given space. */
function greeneryOn(s: GameState, id: string): GameState {
  s = structuredClone(s);
  s.players[s.active].res.plants += 8;
  s = applyAction(s, { t: 'plants' });
  return applyAction(s, { t: 'answer', space: id });
}

describe('maps', () => {
  it('have the published shapes: 61 spaces (91 on Amazonis Planitia) and 12 ocean areas on the standard maps', () => {
    for (const b of BOARD_IDS) {
      const sp = createBoard(b).filter((x) => x.type !== 'off');
      expect(sp.length).toBe(b === 'amazonis' ? 91 : 61);
      if (b !== 'amazonis') expect(sp.filter((x) => x.type === 'ocean').length).toBe(12);
      expect(new Set(sp.map((x) => x.id)).size).toBe(sp.length);
      for (const x of sp) for (const n of neighbours(sp, x.id)) expect(neighbours(sp, n.id).map((y) => y.id)).toContain(x.id);
    }
  });

  it('keeps Amazonis neighbours apart from the standard maps', () => {
    const std = createBoard('tharsis'), big = createBoard('amazonis');
    expect(neighbours(std, '33').map((x) => x.id)).not.toEqual(neighbours(big, '33').map((x) => x.id));
    expect(neighbours(big, '48').length).toBe(6);
  });

  it('Tharsis keeps Noctis City reserved and its four volcanoes', () => {
    const s = ready('tharsis');
    expect(availableSpaces(s, 0, 'land', 'city')).not.toContain('31');
    expect(availableSpaces(s, 0, 'noctis', 'city')).toEqual(['31']);
    expect(availableSpaces(s, 0, 'volcanic', 'special').sort()).toEqual(['09', '14', '21', '29']);
  });

  it('maps without volcanoes or Noctis let those cards go anywhere they could otherwise', () => {
    const s = ready('hellas');
    expect(availableSpaces(s, 0, 'volcanic', 'special').length).toBe(availableSpaces(s, 0, 'land', 'special').length);
    expect(availableSpaces(s, 0, 'noctis', 'city')).toEqual(availableSpaces(s, 0, 'city', 'city'));
    expect(availableSpaces(ready('elysium'), 0, 'volcanic', 'special').sort()).toEqual(['08', '14', '20', '37']);
  });

  it('Hellas south pole costs 6 M€ and places an ocean', () => {
    let s = ready('hellas');
    s = greeneryOn(s, '61');
    expect(s.players[0].res.mc).toBe(94);
    expect(s.prompt?.kind).toBe('space');
    expect(s.prompt?.title).toMatch(/ocean/);
    s = applyAction(s, { t: 'answer', space: (s.prompt as { options: string[] }).options[0] });
    expect(s.oceans).toBe(1);
    // not offered to a player who can't pay
    const poor = ready('hellas');
    poor.players[0].res.mc = 5;
    expect(availableSpaces(poor, 0, 'greenery', 'greenery')).not.toContain('61');
  });

  it('Vastitas north pole costs 4 M€ and raises the temperature', () => {
    let s = ready('vastitas');
    s = greeneryOn(s, '33');
    expect(s.players[0].res.mc).toBe(96);
    expect(s.temperature).toBe(-28);
  });

  it('Amazonis Planitia has longer tracks with their own bonuses', () => {
    let s = ready('amazonis');
    expect(BOARDS.amazonis.params).toMatchObject({ maxTemp: 14, maxOxy: 18, maxOceans: 11 });
    s.oxygen = 6;
    const hand = s.players[0].hand.length;
    s = greeneryOn(s, '51');
    expect(s.oxygen).toBe(7);
    expect(s.players[0].hand.length).toBe(hand + 1);
    s = structuredClone(s);
    s.oxygen = 10;
    s.actionsThisTurn = 0;
    s = greeneryOn(s, '61');
    expect(s.oxygen).toBe(11);
    expect(s.temperature).toBe(-28);
    s = structuredClone(s);
    s.temperature = -14; s.actionsThisTurn = 0; s.active = 1;
    s.players[1].res.heat = 8;
    s = applyAction(s, { t: 'heat' });
    expect(s.players[1].prod.plants).toBe(1);
  });

  it('wild bonus spaces let the player pick a resource', () => {
    let s = ready('amazonis');
    s = greeneryOn(s, '35');
    expect(s.prompt?.kind).toBe('choice');
    s = applyAction(s, { t: 'answer', option: 2 });
    expect(s.players[0].res.titanium).toBe(1);
  });

  for (const b of BOARD_IDS) {
    it(`random players finish a game on ${BOARDS[b].name}`, () => {
      let s = createGame([0, 1, 2].map((i) => ({ name: `P${i}`, color: '#000', cpu: null })), { seed: 40 + b.length, board: b });
      const r = rng(b.length * 13);
      let steps = 0;
      while (s.phase !== 'over' && steps < 40000) { s = applyAction(s, randomAction(s, r)); steps++; }
      expect(s.phase).toBe('over');
      const last = s.history![s.history!.length - 1];
      expect(last.vp).toEqual(s.players.map((p) => score(s, p.id).total));
      expect(s.history![0].turn).toBe(0);
    });
  }

  it('CPUs finish a game on Amazonis Planitia with a drawn set', () => {
    const ma = drawMA('amazonis', { milestones: Array(5).fill(null), awards: Array(5).fill(null) }, setupRandom(3));
    let s = createGame([0, 1, 2].map((i) => ({ name: `C${i}`, color: '#000', cpu: 'easy' as const })), { seed: 9, board: 'amazonis', ...ma });
    let n = 0;
    while (s.phase !== 'over' && n < 9000) { s = applyAction(s, cpuAction(s, 'easy')); n++; }
    expect(s.phase).toBe('over');
    for (const m of s.milestones) expect(ma.milestones).toContain(m.id);
    for (const a of s.awards) expect(ma.awards).toContain(a.id);
  }, 120000);

  it('older saves without a map or milestone list still play as Tharsis', () => {
    let s = ready('tharsis');
    delete s.options.board; delete s.options.milestones; delete s.options.awards; delete s.history;
    expect(gameMilestones(s).map((m) => m.id)).toEqual(BOARDS.tharsis.milestones);
    s = greeneryOn(s, '30');
    expect(s.oxygen).toBe(1);
  });
});

describe('milestones and awards', () => {
  it('each map comes with its own five (gaps for missing expansions filled)', () => {
    for (const b of BOARD_IDS) {
      const sel = boardMA(b, setupRandom(1));
      expect(sel.milestones.length).toBe(5);
      expect(sel.awards.length).toBe(5);
      for (const id of BOARDS[b].milestones) expect(sel.milestones).toContain(id);
      for (const id of BOARDS[b].awards) expect(sel.awards).toContain(id);
      expect(new Set(sel.milestones).size).toBe(5);
    }
  });

  it('look-alikes conflict', () => {
    expect(conflict('gardener', 'cultivator')).toBe(9);
    expect(conflict('builder', 'contractor')).toBe(9);
    expect(conflict('mayor', 'landlord')).toBeGreaterThan(BALANCED.maxPair);
    expect(conflict('builder', 'scientist')).toBe(0);
  });

  it('random draws keep to the rules and around locked picks', () => {
    const r = setupRandom(7);
    for (let k = 0; k < 300; k++) {
      const b = BOARD_IDS[k % BOARD_IDS.length];
      const sel = drawMA(b, { milestones: Array(5).fill(null), awards: Array(5).fill(null) }, r);
      const iss = selectionIssues(sel);
      expect(iss.pairs).toEqual([]);
      expect(iss.crowded).toEqual([]);
      for (const id of [...sel.milestones, ...sel.awards]) expect(availability(b, id)).toBeNull();
    }
    const locked = drawMA('tharsis', { milestones: ['gardener', null, null, null, null], awards: [null, 'cultivator', null, null, null] }, r);
    expect(locked.milestones[0]).toBe('gardener');
    expect(locked.awards[1]).toBe('cultivator');
    // the drawn ones stay clear of the locked ones
    for (const id of [...locked.milestones.slice(1), ...locked.awards.filter((x) => x !== 'cultivator')]) {
      expect(conflict(id, 'gardener')).toBeLessThanOrEqual(BALANCED.maxPair);
    }
  });

  it('only milestones and awards in play can be claimed or funded', () => {
    const s = ready('hellas');
    s.players[0].tr = 40;
    expect(canClaimMilestone(s, 0, 'terraformer')).toBe(false);
    expect(() => applyAction(s, { t: 'award', id: 'landlord' })).toThrow();
    expect(applyAction(s, { t: 'award', id: 'cultivator' }).awards).toEqual([{ id: 'cultivator', pid: 0 }]);
  });

  it('every milestone and award has a working metric', () => {
    let s = createGame([0, 1, 2].map((i) => ({ name: `P${i}`, color: '#000', cpu: null })), { seed: 77, board: 'vastitas' });
    const r = rng(5);
    for (let i = 0; i < 2500 && s.phase !== 'over'; i++) s = applyAction(s, randomAction(s, r));
    for (const d of [...MILESTONES, ...AWARDS]) for (const p of s.players) expect(Number.isFinite(d.metric(s, p.id))).toBe(true);
  });

  it('refuses unknown ids', () => {
    expect(() => createGame([{ name: 'a', color: '', cpu: null }, { name: 'b', color: '', cpu: null }], { milestones: ['nope', 'mayor', 'builder', 'planner', 'gardener'] })).toThrow();
  });
});
