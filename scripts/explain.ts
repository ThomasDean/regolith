let seedv = 7; const R = () => { seedv = (seedv * 16807) % 2147483647; return seedv / 2147483647; };
import { createGame, applyAction } from '../src/engine/game';
import { cpuAction, explainTurn } from '../src/engine/ai/cpu';
import { makeCtx, cardNetValue, cardCoreValue, cardEffectiveCost, horizon, mcValue } from '../src/engine/ai/value';
import { CARDS } from '../src/engine/cards';
import { requirementsMet, canPlayCard } from '../src/engine/queries';
const lvl = 'normal' as any;
let s = createGame([lvl, lvl, lvl].map((l: any, i) => ({ name: `${l}${i}`, color: '#000', cpu: l })), { seed: 42 });
const target = Number(process.argv[2] ?? 4);
while (!(s.generation === target && s.phase === 'action' && !s.prompt)) s = applyAction(s, cpuAction(s, lvl, R));
const pid = s.active, p = s.players[pid];
const w = { lambda: 0.3, synergy: true, tempo: false };
const c = makeCtx(s, pid, w);
console.log('gen', s.generation, 'G', horizon(s), 'mcv', mcValue(c).toFixed(2), 'vp', c.vp.toFixed(1), 'player', p.corp, 'mc', p.res.mc, 'prod', JSON.stringify(p.prod));
for (const id of p.hand) console.log((canPlayCard(s, pid, id) ? 'P ' : requirementsMet(s, pid, id) ? '$ ' : 'R ') + CARDS[id].name.padEnd(30), 'cost', CARDS[id].cost, 'core', cardCoreValue(c, id).toFixed(1), 'eff', cardEffectiveCost(c, id).toFixed(1), 'net', cardNetValue(c, id).toFixed(1));
for (const x of explainTurn(s, lvl).slice(0, 12)) console.log(x.v.toFixed(2), JSON.stringify(x.a).slice(0, 90));
import { positionBreakdown, clockOf } from '../src/engine/ai/value';
const card = process.argv[3];
if (card) {
  const clock = clockOf(s);
  const before = positionBreakdown(s, pid, w, { clock });
  const after = applyAction(s, { t: 'play', card });
  let a2 = after;
  while (a2.prompt && a2.prompt.pid === pid) a2 = applyAction(a2, cpuAction(a2, lvl, R));
  const aft = positionBreakdown(a2, pid, w, { clock });
  console.log('before', before, '\nafter', aft);
  const c2 = makeCtx(a2, pid, w, clock);
  for (const id of a2.players[pid].hand) console.log(CARDS[id].name.padEnd(30), 'net before', cardNetValue(c, id).toFixed(1), 'after', cardNetValue(c2, id).toFixed(1));
}
import { score as sc2 } from '../src/engine/queries';
import { scoreEV } from '../src/engine/ai/value';
if (card) {
  const clock = clockOf(s);
  let a2 = applyAction(s, { t: 'play', card });
  console.log('score before', sc2(s, pid), 'after', sc2(a2, pid));
  console.log('scoreEV before', scoreEV(makeCtx(s, pid, w, clock)), 'after', scoreEV(makeCtx(a2, pid, w, clock)), 'hand', s.players[pid].hand.length, a2.players[pid].hand.length, 'ms', JSON.stringify(s.milestones), JSON.stringify(s.awards));
}
{
  const nets = s.deck.map((id) => cardNetValue(c, id));
  const mean = nets.reduce((a, b) => a + b, 0) / nets.length;
  const held = nets.map((n) => Math.max(0.6, n) * 0.7).reduce((a, b) => a + b, 0) / nets.length;
  const pos = nets.filter((n) => n > 3).length / nets.length;
  console.log('deck mean net', mean.toFixed(1), 'held value', held.toFixed(1), 'share >3', pos.toFixed(2), 'drawValue', (Math.max(1, Math.min(4, 1 + c.G * 0.45))).toFixed(1));
  const top = s.deck.map((id) => [CARDS[id].name, cardNetValue(c, id).toFixed(1), cardCoreValue(c, id).toFixed(1), CARDS[id].cost] as const).sort((a, b) => +b[1] - +a[1]);
  console.log(top.slice(0, 12), top.slice(-8));
}
