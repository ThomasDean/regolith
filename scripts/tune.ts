// Benchmark with a modified Hard config. Usage: HARD='{"weights":{"lambda":0.45}}' tsx scripts/tune.ts <seedStart> <count>
import { createGame, applyAction } from '../src/engine/game';
import { cpuAction, LEVELS } from '../src/engine/ai/cpu';
import { score } from '../src/engine/queries';
import type { Level } from '../src/engine/types';
const patch = JSON.parse(process.env.HARD ?? '{}');
LEVELS.hard = { ...LEVELS.hard, ...patch, weights: { ...LEVELS.hard.weights, ...(patch.weights ?? {}) } };
const levels: Level[] = ['easy', 'normal', 'hard'];
const start = Number(process.argv[2] ?? 1), count = Number(process.argv[3] ?? 10);
const wins: Record<string, number> = {}; const pts: Record<string, number> = {};
let games = 0;
for (let g = start; g < start + count; g++) {
  let seedv = g * 7919 + 3; const R = () => { seedv = (seedv * 16807) % 2147483647; return seedv / 2147483647; };
  const seat = levels.map((_, i) => levels[(i + g) % levels.length]);
  let s = createGame(seat.map((l, i) => ({ name: `${l}${i}`, color: '#000', cpu: l })), { seed: g });
  let n = 0;
  while (s.phase !== 'over' && n < 4000) { const pid = s.prompt ? s.prompt.pid : s.active; s = applyAction(s, cpuAction(s, s.players[pid].cpu!, R)); n++; }
  if (s.phase !== 'over') continue;
  games++;
  const sc = s.players.map((p) => score(s, p.id).total);
  const best = Math.max(...sc);
  s.players.forEach((p, i) => { pts[p.cpu!] = (pts[p.cpu!] ?? 0) + sc[i]; if (sc[i] === best) wins[p.cpu!] = (wins[p.cpu!] ?? 0) + 1; });
}
console.log(JSON.stringify({ games, wins, pts }));
