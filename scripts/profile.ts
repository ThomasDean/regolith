import { createGame, applyAction } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import { turnActions } from '../src/engine/moves';
let s = createGame(['hard','hard','hard'].map((l, i) => ({ name: `${l}${i}`, color: '#000', cpu: l as any })), { seed: 42 });
let n = 0;
const times: Record<string, number[]> = {};
while (s.phase !== 'over' && n < 400) {
  const pid = s.prompt ? s.prompt.pid : s.active;
  const key = s.prompt ? 'prompt:' + s.prompt.kind : s.phase;
  const t = performance.now();
  const a = cpuAction(s, 'hard');
  const dt = performance.now() - t;
  (times[key] ??= []).push(dt);
  if (dt > 500) console.log('slow', key, dt.toFixed(0), 'cands', s.prompt ? '-' : turnActions(s).length, 'hand', s.players[pid].hand.length, JSON.stringify(a).slice(0, 80));
  s = applyAction(s, a); n++;
}
for (const [k, v] of Object.entries(times)) console.log(k, v.length, 'avg', (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), 'max', Math.max(...v).toFixed(0));
