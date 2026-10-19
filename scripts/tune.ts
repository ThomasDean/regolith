// Benchmark with a modified Hard config, seat-rotated.
// Usage: HARD='{"weights":{"lambda":0.45}}' [AGENTS=hard,normal,normal] tsx scripts/tune.ts <seedStart> <count>
import { LEVELS } from '../src/engine/ai/cpu';
import { score } from '../src/engine/queries';
import { playSeeded } from './sim';
const patch = JSON.parse(process.env.HARD ?? '{}');
LEVELS.hard = { ...LEVELS.hard, ...patch, weights: { ...LEVELS.hard.weights, ...(patch.weights ?? {}) } };
const agents = (process.env.AGENTS ?? 'easy,normal,hard').split(',');
const start = Number(process.argv[2] ?? 1), count = Number(process.argv[3] ?? 10);
const wins: Record<string, number> = {}; const pts: Record<string, number[]> = {}; const rel: Record<string, number[]> = {};
let games = 0;
for (let g = start; g < start + count; g++) {
  const { s, seat } = playSeeded(agents, g);
  if (s.phase !== 'over') continue;
  games++;
  const sc = s.players.map((p) => score(s, p.id).total);
  const best = Math.max(...sc), mean = sc.reduce((a, b) => a + b, 0) / sc.length;
  s.players.forEach((p, i) => {
    const a = seat[p.id];
    (pts[a] ??= []).push(sc[i]); (rel[a] ??= []).push(sc[i] - mean);
    if (sc[i] === best) wins[a] = (wins[a] ?? 0) + 1;
  });
}
const avg = (a: number[]) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(JSON.stringify({ patch, games, wins, pts: Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, avg(v)])), vsTable: Object.fromEntries(Object.entries(rel).map(([k, v]) => [k, avg(v)])) }));
