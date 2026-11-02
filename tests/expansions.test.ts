import { describe, it, expect } from 'vitest';
import { applyAction, createGame } from '../src/engine/game';
import { legalActions } from '../src/engine/moves';
import { canPlayCard, requirementsMet } from '../src/engine/queries';
import { colonyAt } from '../src/engine/colonies';
import type { Expansions, GameState } from '../src/engine/types';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', cpu: null }));

/** A game past setup (and preludes) with chosen corporations, in the action phase, everyone rich. */
function ready(corps: string[], ex: Expansions, seed = 1): GameState {
  let s = createGame(seats(corps.length), { seed, expansions: ex });
  while (s.phase === 'setup') {
    const p = s.players[s.active];
    s = applyAction(s, { t: 'setup', corp: 'beginner-corporation', keep: [], ...(p.setup!.preludes ? { preludes: p.setup!.preludes.slice(0, 2) } : {}) });
  }
  s = structuredClone(s);
  s.prompt = null; s.queue = []; s.pendingAction = null;
  s.phase = 'action';
  s.players.forEach((p, i) => {
    p.corp = corps[i];
    p.firstActionDone = true;
    p.preludes = [];
    p.res = { mc: 100, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 };
    p.prod = { mc: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0 };
    p.hand = []; p.played = []; p.cardRes = {};
    p.tr = 20;
  });
  for (const sp of s.board) { delete sp.tile; delete sp.claimedBy; }
  s.temperature = -30; s.oxygen = 0; s.oceans = 0;
  s.active = 0; s.actionsThisTurn = 0;
  return s;
}
/** Pass for everyone until the generation turns over (answering any prompts with the first option). */
function endGen(s: GameState): GameState {
  const g = s.generation;
  for (let i = 0; i < 200 && s.generation === g && s.phase !== 'over'; i++) {
    if (s.prompt) s = applyAction(s, legalActions(s)[0]);
    else s = applyAction(s, { t: 'pass' });
  }
  return s;
}

describe('Prelude', () => {
  it('deals 4 preludes, keeps 2, and plays both before the first action', () => {
    let s = createGame(seats(2), { seed: 9, expansions: { prelude: true } });
    expect(s.players[0].setup!.preludes).toHaveLength(4);
    expect(() => applyAction(s, { t: 'setup', corp: 'beginner-corporation', keep: [] })).toThrow();
    while (s.phase === 'setup') s = applyAction(s, { t: 'setup', corp: 'beginner-corporation', keep: [], preludes: s.players[s.active].setup!.preludes!.slice(0, 2) });
    expect(s.phase).toBe('prelude');
    let n = 0;
    while (s.phase === 'prelude' || s.prompt) { s = applyAction(s, legalActions(s)[0]); n++; }
    expect(s.phase).toBe('action');
    for (const p of s.players) expect(p.played.filter((c) => c !== 'beginner-corporation').length).toBeGreaterThanOrEqual(0);
    expect(n).toBeGreaterThanOrEqual(4);
  });
  it('a prelude that can’t be played in full is swapped for 15 M€', () => {
    let s = ready(['credicor', 'helion'], { prelude: true });
    s.phase = 'prelude';
    s.players[0].preludes = ['business-empire'];
    s.players[0].res.mc = 2; // can't pay the 6 M€
    s = applyAction(s, { t: 'prelude', card: 'business-empire' });
    expect(s.players[0].res.mc).toBe(17);
    expect(s.players[0].prod.mc).toBe(0);
    expect(s.players[0].played).not.toContain('business-empire');
  });
  it('wild tags fill one missing tag in a requirement', () => {
    const s = ready(['credicor', 'helion'], { prelude: true });
    s.players[0].played = ['research-coordination', 'sponsors'];
    s.players[0].hand = ['space-hotels'];
    expect(requirementsMet(s, 0, 'space-hotels')).toBe(true); // 1 Earth + wild = 2
  });
});

describe('Venus Next', () => {
  it('raising Venus gives TR, a card at 8 % and a TR at 16 %', () => {
    let s = ready(['credicor', 'helion'], { venus: true });
    s.venus = 6;
    s.players[0].hand = ['giant-solar-shade'];
    const hand = s.players[0].hand.length;
    s = applyAction(s, { t: 'play', card: 'giant-solar-shade' });
    expect(s.venus).toBe(12);
    expect(s.players[0].tr).toBe(23);
    expect(s.players[0].hand.length).toBe(hand); // played one, drew one at 8 %
    s.active = 0; s.actionsThisTurn = 0;
    s.venus = 14;
    s = applyAction(s, { t: 'sp', id: 'venus' });
    expect(s.venus).toBe(16);
    expect(s.players[0].tr).toBe(25);
  });
  it('World Government raises a parameter after production without TR', () => {
    let s = ready(['credicor', 'helion'], { venus: true });
    const tr = s.players.map((p) => p.tr);
    s = applyAction(s, { t: 'pass' });
    s = applyAction(s, { t: 'pass' });
    expect(s.prompt?.kind).toBe('choice');
    expect(s.prompt!.title).toMatch(/World Government/);
    const i = s.prompt!.kind === 'choice' ? s.prompt!.keys!.indexOf('venus') : -1;
    s = applyAction(s, { t: 'answer', option: i });
    expect(s.venus).toBe(2);
    expect(s.players.map((p) => p.tr)).toEqual(tr);
    expect(s.phase).toBe('research');
  });
  it('Morning Star treats Venus requirements as 2 steps looser', () => {
    const s = ready(['morning-star-inc', 'helion'], { venus: true });
    s.venus = 6;
    s.players[0].hand = ['ishtar-mining'];
    s.players[1].hand = ['ishtar-mining'];
    expect(requirementsMet(s, 0, 'ishtar-mining')).toBe(true);
    expect(requirementsMet(s, 1, 'ishtar-mining')).toBe(false);
  });
  it('Dirigibles’ floaters pay 3 M€ each for Venus cards', () => {
    let s = ready(['credicor', 'helion'], { venus: true });
    s.players[0].played = ['dirigibles'];
    s.players[0].cardRes = { dirigibles: 3 };
    s.players[0].res.mc = 0;
    s.players[0].hand = ['venus-governor', 'ishtar-mining'];
    s.venus = 8;
    s.players[0].played.push('venus-waystation', 'sister-planet-support');
    expect(canPlayCard(s, 0, 'ishtar-mining')).toBe(true); // 5 - 2 = 3 M€ = one floater
    s = applyAction(s, { t: 'play', card: 'ishtar-mining' });
    expect(s.players[0].cardRes.dirigibles).toBe(2);
    expect(s.players[0].prod.titanium).toBe(1);
  });
});

describe('Colonies', () => {
  it('building a colony gives its build bonus and moves the track up to the colonies there', () => {
    let s = ready(['credicor', 'helion', 'ecoline'], { colonies: true });
    s.colonies = [{ id: 'luna', track: 1, active: true, colonies: [], fleet: null }, { id: 'ceres', track: 1, active: true, colonies: [], fleet: null }];
    s = applyAction(s, { t: 'sp', id: 'colony' });
    expect(s.prompt?.kind).toBe('choice');
    s = applyAction(s, { t: 'answer', option: 0 });
    expect(s.players[0].prod.mc).toBe(2);
    expect(s.players[0].res.mc).toBe(100 - 17);
    expect(colonyAt(s, 'luna')!.colonies).toEqual([0]);
  });
  it('trading pays the track, gives owners their colony bonus, and resets the marker', () => {
    let s = ready(['credicor', 'helion', 'ecoline'], { colonies: true });
    s.colonies = [{ id: 'luna', track: 4, active: true, colonies: [1, 2], fleet: null }];
    s = applyAction(s, { t: 'trade', colony: 'luna', pay: 'mc' });
    expect(s.players[0].res.mc).toBe(100 - 9 + 10);
    expect(s.players[1].res.mc).toBe(102);
    expect(s.players[2].res.mc).toBe(102);
    expect(colonyAt(s, 'luna')!.track).toBe(2);
    expect(colonyAt(s, 'luna')!.fleet).toBe(0);
    expect(() => applyAction(s, { t: 'trade', colony: 'luna', pay: 'mc' })).toThrow();
  });
  it('fleets come home and tracks advance at the end of the generation', () => {
    let s = ready(['credicor', 'helion'], { colonies: true });
    s.colonies = [{ id: 'luna', track: 1, active: true, colonies: [], fleet: null }, { id: 'titan', track: 1, active: false, colonies: [], fleet: null }];
    s = applyAction(s, { t: 'trade', colony: 'luna', pay: 'mc' });
    s = endGen(s);
    expect(colonyAt(s, 'luna')!.fleet).toBeNull();
    expect(colonyAt(s, 'luna')!.track).toBe(1); // reset to 0 colonies, then +1
    expect(colonyAt(s, 'titan')!.track).toBe(1); // inactive tiles don't move
    expect(s.players[0].fleetsUsed).toBe(0);
  });
  it('a resource tile opens once a card that holds that resource is played', () => {
    let s = ready(['credicor', 'helion'], { colonies: true });
    s.colonies = [{ id: 'enceladus', track: 1, active: false, colonies: [], fleet: null }];
    s.players[0].hand = ['tardigrades'];
    s = applyAction(s, { t: 'play', card: 'tardigrades' });
    expect(colonyAt(s, 'enceladus')!.active).toBe(true);
  });
  it('Cryo-Sleep makes trading cheaper', () => {
    let s = ready(['credicor', 'helion'], { colonies: true });
    s.colonies = [{ id: 'ceres', track: 2, active: true, colonies: [], fleet: null }];
    s.players[0].played = ['cryo-sleep'];
    s.players[0].res.energy = 2;
    s = applyAction(s, { t: 'trade', colony: 'ceres', pay: 'energy' });
    expect(s.players[0].res.energy).toBe(0);
    expect(s.players[0].res.steel).toBe(3);
  });
});

describe('Turmoil', () => {
  it('the first delegate each generation is free, then 5 M€', () => {
    let s = ready(['credicor', 'helion'], { turmoil: true });
    s = applyAction(s, { t: 'delegate', party: 'reds' });
    expect(s.players[0].res.mc).toBe(100);
    s = applyAction(s, { t: 'delegate', party: 'reds' });
    expect(s.players[0].res.mc).toBe(95);
    expect(s.turmoil!.parties.reds.leader).toBe(0);
  });
  it('the party with most delegates takes power; its leader becomes chairman with 1 TR', () => {
    let s = ready(['credicor', 'helion'], { turmoil: true });
    s.players[0].res.mc = 1000;
    for (let i = 0; i < 4; i++) { s.active = 0; s.actionsThisTurn = 0; s = applyAction(s, { t: 'delegate', party: 'kelvinists' }); }
    expect(s.turmoil!.dominant).toBe('kelvinists');
    s.active = 0; s.actionsThisTurn = 0;
    s = endGen(s);
    expect(s.turmoil!.ruling).toBe('kelvinists');
    expect(s.turmoil!.chairman).toBe(0);
    // -1 TR in the Turmoil phase, +1 as chairman
    expect(s.players[0].tr).toBe(20);
    expect(s.players[1].tr).toBe(19);
  });
  it('the Reds charge 3 M€ per TR raised in an action', () => {
    let s = ready(['credicor', 'helion'], { turmoil: true });
    s.turmoil!.ruling = 'reds';
    s = applyAction(s, { t: 'sp', id: 'asteroid' });
    expect(s.players[0].res.mc).toBe(100 - 14 - 3);
    expect(s.players[0].tr).toBe(21);
  });
  it('party requirements: ruling, or 2 of your delegates there', () => {
    const s = ready(['credicor', 'helion'], { turmoil: true });
    s.turmoil!.ruling = 'greens';
    s.players[0].hand = ['sponsored-mohole'];
    expect(requirementsMet(s, 0, 'sponsored-mohole')).toBe(false);
    s.turmoil!.parties.kelvinists.delegates = [0, 0];
    expect(requirementsMet(s, 0, 'sponsored-mohole')).toBe(true);
  });
  it('keeps every player’s 7 delegates accounted for over a generation', () => {
    let s = ready(['credicor', 'helion', 'ecoline'], { turmoil: true });
    s.players[0].res.mc = 1000;
    for (const party of ['mars', 'mars', 'unity'] as const) { s.active = 0; s.actionsThisTurn = 0; s = applyAction(s, { t: 'delegate', party }); }
    s.active = 0; s.actionsThisTurn = 0;
    s = endGen(s);
    const t = s.turmoil!;
    for (const p of s.players) {
      const out = Object.values(t.parties).reduce((a, ps) => a + ps.delegates.filter((d) => d === p.id).length, 0) + (t.chairman === p.id ? 1 : 0);
      expect(out + t.reserve[p.id]).toBe(7);
    }
  });
});
