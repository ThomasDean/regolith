// Custom cards: checked, turned into ordinary cards, shuffled into the deck, and played by the
// engine and the CPUs like any other card.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import { CARDS } from '../src/engine/cards';
import { finishCustom, type CustomCard } from '../src/engine/custom';
import { cardActionAvailable, canPlayCard, cardCost, score } from '../src/engine/queries';
import type { GameState } from '../src/engine/types';

const draft = (c: Partial<CustomCard>) => ({ name: 'Test Card', type: 'automated', cost: 10, tags: [], play: [], ...c });

const SET: CustomCard[] = [
  finishCustom(draft({ name: 'Algae Vats', cost: 9, tags: ['plant'], play: [{ k: 'prod', r: 'plants', n: 2 }], vp: { n: 1 } })),
  finishCustom(draft({ name: 'Rail Spur', cost: 14, tags: ['building'], play: [{ k: 'prod', r: 'mc', n: 2 }, { k: 'res', r: 'steel', n: 3 }], req: { param: 'oxy', min: 3 } })),
  finishCustom(draft({ name: 'Comet Strike', type: 'event', cost: 18, tags: ['space'], play: [{ k: 'temp', n: 1 }, { k: 'ocean' }, { k: 'removeAny', r: 'plants', n: 3 }] })),
  finishCustom(draft({ name: 'Moss Colony', type: 'active', cost: 7, tags: ['microbe'], resource: 'microbe', play: [{ k: 'addRes', n: 1 }], vp: { perRes: 2 },
    action: { gain: [{ k: 'addRes', n: 1 }] } })),
  finishCustom(draft({ name: 'Heat Exchange', type: 'active', cost: 11, tags: ['power'], action: { costRes: { r: 'heat', n: 4 }, gain: [{ k: 'tr', n: 1 }] } })),
  finishCustom(draft({ name: 'Science Grant', type: 'active', cost: 12, tags: ['science'], effect: { when: 'playTag', tag: 'science', gain: [{ k: 'res', r: 'mc', n: 3 }] } })),
  finishCustom(draft({ name: 'Zoning Office', type: 'active', cost: 10, tags: ['city'], effect: { when: 'anyCity', gain: [{ k: 'res', r: 'mc', n: 2 }] } })),
  finishCustom(draft({ name: 'Open Habitat', cost: 20, tags: ['city', 'building'], play: [{ k: 'city' }, { k: 'prod', r: 'energy', n: -1 }, { k: 'prod', r: 'mc', n: 3 }] })),
  finishCustom(draft({ name: 'Cloud Seeding', cost: 11, tags: ['venus'], play: [{ k: 'venus', n: 1 }] })),
];

describe('custom cards: checks', () => {
  it('rejects broken cards with a reason', () => {
    expect(() => finishCustom(draft({ name: '' }))).toThrow(/name/);
    expect(() => finishCustom(draft({ cost: 99, play: [{ k: 'tr', n: 1 }] }))).toThrow(/Cost/);
    expect(() => finishCustom(draft({ tags: ['building', 'space', 'city', 'plant'], play: [{ k: 'tr', n: 1 }] }))).toThrow(/3 tags/);
    expect(() => finishCustom(draft({ play: [{ k: 'tr', n: 9 }] }))).toThrow(/amount/);
    expect(() => finishCustom(draft({ play: [{ k: 'addRes', n: 1 }] }))).toThrow(/resource type/);
    expect(() => finishCustom(draft({ play: [{ k: 'nuke' }] as never }))).toThrow(/unknown effect/);
    expect(() => finishCustom(draft({ action: { gain: [{ k: 'tr', n: 1 }] } }))).toThrow(/Only active/);
    expect(() => finishCustom(draft({}))).toThrow(/does nothing/);
  });

  it('gives a card an id from its content, so an edit makes a new card', () => {
    const a = finishCustom(draft({ play: [{ k: 'tr', n: 1 }] }));
    const b = finishCustom(draft({ play: [{ k: 'tr', n: 1 }] }));
    const c = finishCustom(draft({ play: [{ k: 'tr', n: 2 }] }));
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id).toMatch(/^cc-/);
  });
});

describe('custom cards in play', () => {
  const game = (seed: number, venus = false) => createGame(['A', 'B', 'C'].map((name) => ({ name, color: '#000', cpu: 'normal' as const })), { seed, custom: SET, expansions: { venus } });

  it('puts them in the deck (Venus ones only with Venus Next) and describes them', () => {
    const s = game(1);
    const all = [...s.deck, ...s.players.flatMap((p) => p.setup!.cards)];
    for (const c of SET.filter((x) => x.name !== 'Cloud Seeding')) expect(all).toContain(c.id);
    expect(all).not.toContain(SET[8].id);
    const v = game(1, true);
    expect([...v.deck, ...v.players.flatMap((p) => p.setup!.cards)]).toContain(SET[8].id);
    expect(CARDS[SET[3].id].text).toMatch(/Add 1 microbe here.*Action: add 1 microbe here/);
  });

  it('plays, uses actions, fires effects and scores', () => {
    let s = game(2);
    for (let k = 0; k < 3; k++) s = applyAction(s, { t: 'setup', corp: s.players[s.active].setup!.corps[0], keep: [] });
    const pid = s.active;
    const p = () => s.players[pid];
    const give = (id: string) => { s = structuredClone(s); s.players[pid].hand.push(id); s.players[pid].res.mc = 200; s.players[pid].res.heat = 10; };
    // Algae Vats: +2 plant production, 1 VP
    give(SET[0].id);
    const vp = score(s, pid).total;
    const plants = p().prod.plants;
    s = applyAction(s, { t: 'play', card: SET[0].id });
    expect(p().prod.plants).toBe(plants + 2);
    expect(score(s, pid).total).toBe(vp + 1);
    // Moss Colony: starts with a microbe; its action adds another; 1 VP per 2
    give(SET[3].id);
    s.actionsThisTurn = 0;
    s = applyAction(s, { t: 'play', card: SET[3].id });
    while (s.active !== pid || s.prompt) s = applyAction(s, cpuAction(s, 'normal'));
    expect(cardActionAvailable(s, pid, SET[3].id)).toBe(true);
    s = applyAction(s, { t: 'cardAction', card: SET[3].id });
    expect(p().cardRes[SET[3].id]).toBe(2);
    expect(score(s, pid).cards).toBeGreaterThanOrEqual(2);
    // Science Grant: +3 M€ when you play a science tag (itself included)
    while (s.active !== pid || s.prompt) s = applyAction(s, cpuAction(s, 'normal'));
    give(SET[5].id);
    const mc = p().res.mc;
    const price = cardCost(s, pid, SET[5].id);
    s = applyAction(s, { t: 'play', card: SET[5].id });
    expect(p().res.mc).toBe(mc - price + 3);
    // Rail Spur needs 3% oxygen
    give(SET[1].id);
    expect(canPlayCard(s, pid, SET[1].id)).toBe(s.oxygen >= 3);
  });

  it('survives whole CPU games with the cards in the deck', () => {
    let dealt = 0;
    for (const seed of [3, 4]) {
      let s: GameState = game(seed, seed === 4);
      // put them on top of the deck so the CPUs are offered them early
      s.deck = [...s.deck.filter((id) => !id.startsWith('cc-')), ...s.deck.filter((id) => id.startsWith('cc-'))];
      const inDeck = s.deck.filter((id) => id.startsWith('cc-')).length;
      for (let i = 0; i < 6000 && s.phase !== 'over'; i++) s = applyAction(s, cpuAction(s, s.players[s.prompt ? s.prompt.pid : s.active].cpu!));
      expect(s.phase).toBe('over');
      // whether the CPUs buy them is up to them; what matters is the cards went round and nothing broke
      dealt += inDeck - s.deck.filter((id) => id.startsWith('cc-')).length;
    }
    expect(dealt).toBeGreaterThan(0);
  }, 120000);
});
