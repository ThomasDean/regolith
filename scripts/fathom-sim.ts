// Plays CPU games of Fathom and prints scores: npx tsx scripts/fathom-sim.ts easy,normal,hard 10 [variable]
import { createGame, applyActionMut, standings, score } from '../src/fathom/engine/game';
import { cpuAction } from '../src/fathom/engine/cpu';
import type { Level } from '../src/fathom/engine/types';

const levels = (process.argv[2] ?? 'normal,normal,normal').split(',') as Level[];
const games = Number(process.argv[3] ?? 5);
const variable = process.argv[4] === 'variable';
const wins = levels.map(() => 0), totals = levels.map(() => 0);
const parts: Record<string, number>[] = levels.map(() => ({}));
let ms = 0, decisions = 0;
for (let g = 0; g < games; g++) {
  // rotate seats so first-player luck evens out
  const order = levels.map((_, i) => (i + g) % levels.length);
  let s = createGame(order.map((i) => ({ name: `P${i}`, color: '#000', cpu: levels[i] })), { seed: 1000 + g, variable });
  for (let guard = 0; guard < 2000 && s.phase !== 'over'; guard++) {
    const lv = s.players[s.prompt ? s.prompt.pid : s.active].cpu!;
    const t = performance.now();
    const a = cpuAction(s, lv);
    ms += performance.now() - t; decisions++;
    applyActionMut(s, a);
  }
  const st = standings(s);
  wins[order[st[0].pid]]++;
  s.players.forEach((p, seat) => {
    const sc = score(s, seat); totals[order[seat]] += sc.total;
    for (const [k, v] of Object.entries(sc)) parts[order[seat]][k] = (parts[order[seat]][k] ?? 0) + v;
  });
  console.log(`game ${g}: ${st.map((x) => `${levels[order[x.pid]]} ${x.sc.total}`).join('  ')}  (released ${s.players.map((p) => p.stats.released).join('/')})`);
}
levels.forEach((l, i) => console.log(`${l}: wins ${wins[i]}, avg ${(totals[i] / games).toFixed(1)}  ${Object.entries(parts[i]).map(([k, v]) => `${k} ${(v / games).toFixed(1)}`).join(' ')}`));
console.log(`avg ${(ms / decisions).toFixed(1)} ms per decision`);
