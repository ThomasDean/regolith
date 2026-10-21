// How well does the CPU's "generations left" estimate match reality?
// Usage: tsx scripts/horizon-check.ts <agent> <games>
import { playSeeded } from './sim';
import { horizon } from '../src/engine/ai/value';
import { stepsLeft } from '../src/engine/queries';
const lvl = process.argv[2] ?? 'normal';
const games = Number(process.argv[3] ?? 12);
const rows: Record<number, { h: number[]; real: number[]; steps: number[] }> = {};
for (let g = 1; g <= games; g++) {
  const seen: { gen: number; h: number; st: number }[] = [];
  let last = 0;
  const { s } = playSeeded([lvl, lvl, lvl], g, (s) => {
    if (s.phase === 'action' && !s.prompt && s.generation !== last) { last = s.generation; seen.push({ gen: s.generation, h: horizon(s), st: stepsLeft(s) }); }
  });
  for (const x of seen) {
    const r = (rows[x.gen] ??= { h: [], real: [], steps: [] });
    r.h.push(x.h); r.real.push(s.generation - x.gen + 1); r.steps.push(x.st);
  }
}
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
for (const [g, r] of Object.entries(rows)) console.log('gen', g.padStart(2), 'horizon', avg(r.h), 'actual left', avg(r.real), 'stepsLeft', avg(r.steps), 'n', r.h.length);
