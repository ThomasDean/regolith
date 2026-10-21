// Seat-rotated CPU tournament.
// Usage: tsx scripts/batch.ts <agents comma list> <seedStart> <count>
//   agents: easy | normal | hard, or old-easy | old-normal | old-hard for the frozen pre-rework
//   evaluator in scripts/baseline/ (e.g. `normal,old-normal,normal`). Ties count as a win for each.
import { playSeeded } from './sim';
import { score } from '../src/engine/queries';
const agents = (process.argv[2] ?? 'normal,normal,normal').split(',');
const start = Number(process.argv[3] ?? 1), count = Number(process.argv[4] ?? 10);
const wins: Record<string, number> = {}; const pts: Record<string, number[]> = {}; const gens: number[] = []; const cards: number[] = [];
const margin: Record<string, number[]> = {}; // VP minus the game's average, per agent
for (let g = start; g < start + count; g++) {
  const { s, seat } = playSeeded(agents, g);
  if (s.phase !== 'over') {
    console.log('STALL seed', g, 'gen', s.generation, s.temperature, s.oxygen, s.oceans);
    const fs = await import('node:fs');
    fs.writeFileSync(`${process.env.SCRATCH ?? '.'}/stall-${g}.json`, JSON.stringify(s));
    continue;
  }
  gens.push(s.generation);
  if (s.generation > 16) console.log('LONG seed', g, 'gens', s.generation, 'seats', seat.join(','));
  const sc = s.players.map((p) => score(s, p.id).total);
  const best = Math.max(...sc);
  const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
  s.players.forEach((p, i) => {
    const a = seat[p.id];
    (pts[a] ??= []).push(sc[i]);
    (margin[a] ??= []).push(sc[i] - mean);
    cards.push(p.played.length);
    if (sc[i] === best) wins[a] = (wins[a] ?? 0) + 1;
  });
}
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
const se = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1) / a.length).toFixed(1);
};
console.log(JSON.stringify({
  games: gens.length, avgGen: avg(gens), maxGen: Math.max(...gens), cards: avg(cards), wins,
  pts: Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, avg(v)])),
  vsTable: Object.fromEntries(Object.entries(margin).map(([k, v]) => [k, `${avg(v)} ±${se(v)}`])),
}));
