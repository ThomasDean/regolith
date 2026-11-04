import { describe, expect, it } from 'vitest';
import { applyAction, applyActionMut, BAIT_SLOTS, canPlace, createGame, forfeit, moveOptions, score, standings, top } from '../src/fathom/engine/game';
import { cpuAction, candidateActions } from '../src/fathom/engine/cpu';
import { BAIT, FISH } from '../src/fathom/engine/cards';
import { DIVERS, slotOf, type FAction, type FState, type Level } from '../src/fathom/engine/types';

const seats = (n: number, cpu: Level | null = null) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', cpu }));
const noPay = { cards: [], eggs: [], fry: [] };

function give(s: FState, pid: number, card: string) {
  s.players[pid].hand.push(card);
  s.deck = s.deck.filter((c) => c !== card);
}

describe('setup', () => {
  it('deals two starters and three deck fish, and lays out the starting ocean', () => {
    const s = createGame(seats(3), { seed: 4 });
    for (const p of s.players) {
      expect(p.hand).toHaveLength(5);
      expect(p.hand.filter((c) => FISH[c].starter)).toHaveLength(2);
      expect(BAIT_SLOTS.every((i) => top(p.ocean[i]) === BAIT)).toBe(true);
      expect(p.ocean.filter((x) => x.egg)).toHaveLength(2);
      expect(p.ocean.reduce((n, x) => n + x.fry, 0)).toBe(1);
      expect(p.divers).toBe(DIVERS);
    }
    expect(s.goals).toEqual(['brood', 'rows', 'schools']);
  });

  it('replays exactly from a seed', () => {
    const a = createGame(seats(2), { seed: 9 });
    const b = createGame(seats(2), { seed: 9 });
    expect(a).toEqual(b);
  });
});

describe('releasing fish', () => {
  it('enforces zones, sites, edges and eating', () => {
    const s = createGame(seats(2), { seed: 1 });
    const p = s.players[0];
    expect(canPlace(p, 'snailfish', slotOf(5, 0))).toBe(true); // abyss only
    expect(canPlace(p, 'snailfish', slotOf(4, 0))).toBe(false);
    expect(canPlace(p, 'mandarinfish', slotOf(0, 1))).toBe(true); // Reef site
    expect(canPlace(p, 'mandarinfish', slotOf(0, 0))).toBe(false);
    expect(canPlace(p, 'lanternfish', slotOf(0, 0))).toBe(false); // twilight/midnight fish
    // eating: must cover something shorter
    expect(canPlace(p, 'snook', slotOf(1, 0))).toBe(true); // over the bait shoal
    expect(canPlace(p, 'snook', slotOf(0, 2))).toBe(false); // nothing to eat there
  });

  it('pays costs, keeps tokens on eaten fish and scores the eaten one', () => {
    const s = createGame(seats(2), { seed: 2 });
    s.active = 0;
    const p = s.players[0];
    p.hand = ['snook', 'pinfish', 'sardine'];
    const t = applyAction(s, { t: 'release', card: 'snook', slot: slotOf(1, 0), pay: { cards: ['pinfish'], eggs: [], fry: [] } });
    const q = t.players[0];
    expect(top(q.ocean[slotOf(1, 0)])).toBe('snook');
    expect(q.ocean[slotOf(1, 0)].egg).toBe(true); // the bait's egg stays
    expect(q.discard).toEqual(['pinfish']);
    expect(q.divers).toBe(DIVERS - 1);
    expect(score(t, 0).eaten).toBe(1);
    expect(() => applyAction(s, { t: 'release', card: 'snook', slot: slotOf(1, 0), pay: noPay })).toThrow(/Discard exactly 1/);
  });
});

describe('diving', () => {
  it('collects the site bonuses top to bottom and the bottom bonus once a tide', () => {
    const s = createGame(seats(2), { seed: 3 });
    s.active = 0;
    const hand = s.players[0].hand.length;
    // Kelp: bait in Sunlight gives a card, first to the bottom gives two more
    const t = applyAction(s, { t: 'dive', col: 0 });
    expect(t.players[0].hand.length).toBe(hand + 3);
    expect(t.players[0].bottom[0]).toBe(true);
    expect(t.active).toBe(1);
  });

  it('asks where to put fry, and forms schools of three', () => {
    const s = createGame(seats(2), { seed: 5 });
    s.active = 0;
    const p = s.players[0];
    p.ocean[slotOf(0, 2)].fry = 2;
    let t = applyAction(s, { t: 'dive', col: 2 }); // midnight bait: an egg (one choice is made for you only if there's one)
    while (t.prompt && t.prompt.kind !== 'fry') t = applyAction(t, { t: 'answer', choice: 0 });
    expect(t.prompt?.kind).toBe('fry');
    t = applyAction(t, { t: 'answer', choice: t.prompt!.options.findIndex((o) => o.slot === slotOf(0, 2)) });
    expect(t.players[0].ocean[slotOf(0, 2)].school).toBe(true);
    expect(t.players[0].ocean[slotOf(0, 2)].fry).toBe(0);
  });

  it('moves fry in straight lines, stopping where a school forms, and never through a school', () => {
    const s = createGame(seats(1), { seed: 6 });
    const p = s.players[0];
    for (const x of p.ocean) { x.fry = 0; x.school = false; }
    p.ocean[slotOf(0, 0)].fry = 1;
    p.ocean[slotOf(2, 0)].fry = 2;
    p.ocean[slotOf(3, 1)].school = true;
    p.ocean[slotOf(3, 0)].school = true;
    const fromTop = moveOptions(p).filter((o) => o.move!.from === slotOf(0, 0) && o.move!.what === 'fry').map((o) => o.move!.to);
    expect(fromTop).toContain(slotOf(2, 0));
    expect(fromTop).not.toContain(slotOf(3, 0)); // stops at the slot that becomes a school
    const school = moveOptions(p).filter((o) => o.move!.from === slotOf(3, 0) && o.move!.what === 'school').map((o) => o.move!.to);
    expect(school).not.toContain(slotOf(3, 1));
    expect(school).not.toContain(slotOf(3, 2));
  });
});

describe('tides and scoring', () => {
  it('scores the tide goal and starts the next tide with a new first player', () => {
    let s = createGame(seats(2), { seed: 7 });
    const first = s.first;
    for (let i = 0; i < 2 * DIVERS; i++) {
      s = applyAction(s, { t: 'dive', col: i % 3 });
      while (s.prompt) s = applyAction(s, { t: 'answer', choice: null });
    }
    expect(s.tide).toBe(2);
    expect(s.first).toBe((first + 1) % 2);
    for (const p of s.players) {
      expect(p.goals).toHaveLength(1);
      expect(p.divers).toBe(DIVERS);
    }
  });

  it('plays whole games with random legal moves', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let s = createGame(seats(1 + (seed % 5)), { seed, variable: seed % 2 === 0 });
      let x = seed * 7919;
      const r = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      for (let guard = 0; guard < 3000 && s.phase !== 'over'; guard++) {
        let a: FAction;
        if (s.prompt) a = { t: 'answer', choice: r() < 0.15 ? null : Math.floor(r() * s.prompt.options.length) };
        else { const c = candidateActions(s, s.active); a = c[Math.floor(r() * c.length)]; }
        s = applyAction(s, a);
        for (const p of s.players) for (const sl of p.ocean) {
          expect(sl.fry).toBeGreaterThanOrEqual(0);
          if (!sl.school) expect(sl.fry).toBeLessThan(3);
          if (sl.egg) expect(sl.fish.length).toBeGreaterThan(0);
        }
      }
      expect(s.phase).toBe('over');
      expect(s.tide).toBe(4);
      expect(s.history).toHaveLength(4);
      // every card is somewhere exactly once
      const all = [...s.deck, ...s.players.flatMap((p) => [...p.hand, ...p.discard, ...p.ocean.flatMap((o) => o.fish.filter((f) => f !== BAIT))])];
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe('CPU players', () => {
  it('finish games at every level, deterministically', () => {
    const play = (seed: number) => {
      const s = createGame([{ name: 'E', color: '#000', cpu: 'easy' }, { name: 'N', color: '#000', cpu: 'normal' }, { name: 'H', color: '#000', cpu: 'hard' }], { seed, variable: true });
      for (let guard = 0; guard < 2000 && s.phase !== 'over'; guard++) applyActionMut(s, cpuAction(s, s.players[s.prompt ? s.prompt.pid : s.active].cpu!));
      return s;
    };
    const a = play(11);
    expect(a.phase).toBe('over');
    expect(standings(a)[0].sc.total).toBeGreaterThan(60);
    const b = play(11);
    expect(b.players.map((p) => score(b, p.id).total)).toEqual(a.players.map((p) => score(a, p.id).total));
  }, 60_000);
});

describe('forfeit', () => {
  it('hands the seat to a CPU and ranks it last', () => {
    const s = createGame([{ name: 'A', color: '#000', cpu: null }, { name: 'B', color: '#000', cpu: null }, { name: 'C', color: '#000', cpu: 'normal' }], { seed: 3 });
    s.players[0].ocean[slotOf(0, 0)].school = true; // A is ahead on points
    const t = forfeit(s, 0);
    expect(t.phase).toBe('play');
    expect(t.players[0].cpu).toBe('normal');
    expect(standings(t)[2].pid).toBe(0);
  });

  it('ends the game when only one player, or no human, is left', () => {
    const two = forfeit(createGame(seats(2), { seed: 1 }), 1);
    expect(two.phase).toBe('over');
    expect(two.endedBy).toBe('forfeit');
    expect(standings(two)[0].pid).toBe(0);
    const solo = forfeit(createGame([{ name: 'A', color: '#000', cpu: null }, { name: 'B', color: '#000', cpu: 'easy' }, { name: 'C', color: '#000', cpu: 'easy' }], { seed: 1 }), 0);
    expect(solo.phase).toBe('over');
  });
});
