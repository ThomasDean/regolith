import { createGame, applyAction } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import { score } from '../src/engine/queries';
const lvl = (process.argv[2] ?? 'normal') as any;
let s = createGame([lvl, lvl, lvl].map((l: any, i) => ({ name: `${l}${i}`, color: '#000', cpu: l })), { seed: Number(process.argv[3] ?? 42) });
let n = 0, gen = 0;
let seedv = Number(process.argv[3] ?? 42) * 7 + 1; const R = () => { seedv = (seedv * 16807) % 2147483647; return seedv / 2147483647; };
const stopAt = Number(process.argv[4] ?? 9999);
const acts: Record<string, number> = {};
while (s.phase !== 'over' && n < 6000) {
  if (s.generation >= stopAt && s.phase === 'action' && !s.prompt) break;
  const a = cpuAction(s, lvl, R);
  const k = a.t === 'sp' ? 'sp:' + a.id : a.t; acts[k] = (acts[k] ?? 0) + 1;
  s = applyAction(s, a); n++;
  if (s.generation !== gen) { gen = s.generation; console.log('gen', gen, 'T', s.temperature, 'O', s.oxygen, 'Oc', s.oceans, s.players.map((p) => `${p.corp}:${score(s, p.id).total}tr${p.tr} mc${p.res.mc} p${p.prod.mc} h${p.hand.length} pl${p.played.length}`).join(' | ')); }
}
console.log('phase', s.phase, 'steps', n, acts);
console.log(s.log.slice(-25).map((l) => l.text).join('\n'));
if (s.phase === 'action') {
  const { explainTurn } = await import('../src/engine/ai/cpu');
  const { clockOf, makeCtx, mcValue, trValue } = await import('../src/engine/ai/value');
  const c = makeCtx(s, s.active, { lambda: 0.3, synergy: true, tempo: false });
  console.log('clock', clockOf(s), 'mcv', mcValue(c), 'tr', trValue(c), 'active', s.active, s.players[s.active].res);
  for (const x of explainTurn(s, lvl, R).slice(0, 10)) console.log(x.v.toFixed(2), JSON.stringify(x.a).slice(0, 80));
}
