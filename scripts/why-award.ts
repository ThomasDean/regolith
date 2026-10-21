// Show why a CPU funds an award: find the first award funded in each seeded game and print the
// top candidate actions at that moment with their estimated gains.
// Usage: tsx scripts/why-award.ts <agent> <seedStart> <count>
import { playSeeded, levelOf, lcg } from './sim';
import * as cur from '../src/engine/ai/cpu';
import * as old from './baseline/cpu';
import { AWARDS, awardCost } from '../src/engine/queries';
import type { GameState } from '../src/engine/types';

const agent = process.argv[2] ?? 'normal';
const start = Number(process.argv[3] ?? 1), count = Number(process.argv[4] ?? 3);
const explain = agent.startsWith('old-') ? old.explainTurn : cur.explainTurn;
for (let g = start; g < start + count; g++) {
  let found: GameState | null = null;
  try {
    playSeeded([agent, agent, agent], g, (s, pid, a) => {
      if (!found && a.t === 'award') { found = structuredClone(s); void pid; throw new Error('stop'); }
    });
  } catch { /* stopped at the first award */ }
  if (!found) { console.log('seed', g, 'no award'); continue; }
  const s = found as GameState;
  const pid = s.active;
  console.log(`\nseed ${g} gen ${s.generation} ${s.players[pid].name} (${s.players[pid].corp}) M€ ${s.players[pid].res.mc}, award cost ${awardCost(s)}`);
  for (const a of AWARDS) console.log('  ', a.id.padEnd(11), s.players.map((q) => a.metric(s, q.id)).join(' / '));
  for (const x of explain(s, levelOf(agent), lcg(g)).slice(0, 8)) console.log('  ', x.v.toFixed(2).padStart(7), JSON.stringify(x.a).slice(0, 80));
}
