// Break down a CPU decision: play seeded game <seed> until generation <gen>'s action phase (or
// until the first action matching <kind>, e.g. "sp:aquifer" or "award"), then show how each top
// candidate changes the evaluation terms (score, stock, income, engine, hand).
// Usage: tsx scripts/inspect.ts <agent> <seed> <gen|kind>
import { playSeeded, levelOf, lcg } from './sim';
import * as cur from '../src/engine/ai/cpu';
import * as curV from '../src/engine/ai/value';
import * as old from './baseline/cpu';
import * as oldV from './baseline/value';
import { applyAction } from '../src/engine/game';
import type { Action, GameState } from '../src/engine/types';

const agent = process.argv[2] ?? 'normal';
const seed = Number(process.argv[3] ?? 1);
const target = process.argv[4] ?? '1';
const isOld = agent.startsWith('old-');
const C = isOld ? old : cur, V = isOld ? oldV : curV;
const key = (a: Action) => (a.t === 'sp' ? `sp:${a.id}` : a.t);
let found: GameState | null = null;
try {
  playSeeded([agent, agent, agent], seed, (s, _pid, a) => {
    if (s.phase !== 'action' || s.prompt) return;
    const hit = /^\d+$/.test(target) ? s.generation === +target : key(a) === target;
    if (hit) { found = structuredClone(s); throw new Error('stop'); }
  });
} catch { /* stopped */ }
if (!found) { console.log('not reached'); process.exit(0); }
const s = found as GameState;
const pid = s.active;
const cfg = C.LEVELS[levelOf(agent)];
const clock = V.clockOf(s);
const before = V.positionBreakdown(s, pid, cfg.weights, { clock });
const p = s.players[pid];
console.log(`gen ${s.generation} ${p.name} ${p.corp} M€ ${p.res.mc} TR ${p.tr} prod ${JSON.stringify(p.prod)} G ${clock.G}`);
console.log('before', Object.fromEntries(Object.entries(before).map(([k, v]) => [k, +v.toFixed(1)])));
const R = lcg(seed);
for (const x of C.explainTurn(s, levelOf(agent), R).slice(0, 10)) {
  let after = applyAction(s, x.a);
  for (let i = 0; i < 20 && after.prompt && after.prompt.pid === pid; i++) after = applyAction(after, C.cpuAction(after, levelOf(agent), R));
  const b = V.positionBreakdown(after, pid, cfg.weights, { clock });
  const d = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +(v - (before as Record<string, number>)[k]).toFixed(1)]));
  console.log(x.v.toFixed(2).padStart(7), JSON.stringify(x.a).slice(0, 60).padEnd(60), JSON.stringify(d));
}
