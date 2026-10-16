// Usage: tsx scripts/batch.ts <levels comma list> <seedStart> <count>
import { createGame, applyAction } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
import { score } from '../src/engine/queries';
const levels = (process.argv[2] ?? 'normal,normal,normal').split(',') as any[];
const start = Number(process.argv[3] ?? 1), count = Number(process.argv[4] ?? 10);
const wins: Record<string, number> = {}; const pts: Record<string, number[]> = {}; const gens: number[] = []; const cards: number[] = [];
for (let g = start; g < start + count; g++) {
  let seedv = g * 7919 + 3; const R = () => { seedv = (seedv * 16807) % 2147483647; return seedv / 2147483647; };
  // rotate seats so no level always sits first
  const seat = levels.map((_, i) => levels[(i + g) % levels.length]);
  let s = createGame(seat.map((l, i) => ({ name: `${l}${i}`, color: '#000', cpu: l })), { seed: g });
  let n = 0;
  while (s.phase !== 'over' && n < 3000) { const pid = s.prompt ? s.prompt.pid : s.active; s = applyAction(s, cpuAction(s, s.players[pid].cpu!, R)); n++; }
  if (s.phase !== 'over') {
    console.log('STALL seed', g, 'gen', s.generation, s.temperature, s.oxygen, s.oceans);
    const fs = await import('node:fs');
    fs.writeFileSync(`${process.env.SCRATCH ?? '.'}/stall-${g}.json`, JSON.stringify(s));
    continue;
  }
  gens.push(s.generation);
  const sc = s.players.map((p) => score(s, p.id).total);
  const best = Math.max(...sc);
  s.players.forEach((p, i) => { (pts[p.cpu!] ??= []).push(sc[i]); cards.push(p.played.length); if (sc[i] === best) wins[p.cpu!] = (wins[p.cpu!] ?? 0) + 1; });
}
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(JSON.stringify({ games: gens.length, avgGen: avg(gens), maxGen: Math.max(...gens), cards: avg(cards), wins, pts: Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, avg(v)])) }));
