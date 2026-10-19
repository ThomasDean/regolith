// How the CPU values each corporation at setup (average over seeds), vs. how it actually does.
// Usage: tsx scripts/corps.ts <agent> <seeds>
import { createGame, applyActionMut } from '../src/engine/game';
import { CORP_IDS } from '../src/engine/cards';
import * as curV from '../src/engine/ai/value';
import * as oldV from './baseline/value';
import * as cur from '../src/engine/ai/cpu';
import * as old from './baseline/cpu';
import { levelOf } from './sim';

const agent = process.argv[2] ?? 'normal';
const seeds = Number(process.argv[3] ?? 10);
const V = agent.startsWith('old-') ? oldV : curV;
const C = agent.startsWith('old-') ? old : cur;
const w = C.LEVELS[levelOf(agent)].weights;
const tot: Record<string, number[]> = {};
for (let g = 1; g <= seeds; g++) {
  for (const corp of CORP_IDS) {
    if (corp === 'beginner-corporation') continue;
    const s = createGame([0, 1, 2].map((i) => ({ name: `p${i}`, color: '#000', cpu: levelOf(agent) })), { seed: g });
    const me = s.active, p = s.players[me];
    p.setup = { ...p.setup!, corps: [corp, ...p.setup!.corps] };
    applyActionMut(s, { t: 'setup', corp, keep: [] });
    const b = V.positionBreakdown(s, me, w as never);
    (tot[corp] ??= []).push(b.score + b.stock + b.income + b.engine);
  }
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
for (const [c, v] of Object.entries(tot).sort((a, b) => avg(b[1]) - avg(a[1]))) console.log(c.padEnd(32), avg(v).toFixed(1));
