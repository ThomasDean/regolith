// Calibration data for the award model: how much does the gap between two players' award
// metrics move between a given generation and the end of the game?
// Usage: tsx scripts/award-drift.ts <agent> <games>
import { playSeeded } from './sim';
import { AWARDS } from '../src/engine/queries';
import type { GameState } from '../src/engine/types';
import { awardProjection } from '../src/engine/ai/value';

const agent = process.argv[2] ?? 'normal';
const games = Number(process.argv[3] ?? 20);
// per award, per generations-left bucket: residuals of the naive (current gap) and projected predictors
const rows: Record<string, Record<number, { naive: number[]; proj: number[] }>> = {};
for (let g = 1; g <= games; g++) {
  const snaps: { s: GameState; gen: number }[] = [];
  let last = 0;
  const { s: end } = playSeeded([agent, agent, agent], g, (s) => {
    if (s.phase === 'action' && !s.prompt && s.generation !== last) { last = s.generation; snaps.push({ s: structuredClone({ ...s, log: [] }), gen: s.generation }); }
  });
  for (const a of AWARDS) {
    const fin = end.players.map((p) => a.metric(end, p.id));
    for (const { s, gen } of snaps) {
      const left = end.generation - gen + 1;
      const cur = s.players.map((p) => a.metric(s, p.id));
      const proj = s.players.map((p) => awardProjection(s, p.id, a.id, left).mean);
      const b = ((rows[a.id] ??= {})[Math.min(left, 10)] ??= { naive: [], proj: [] });
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        b.naive.push((fin[i] - fin[j]) - (cur[i] - cur[j]));
        b.proj.push((fin[i] - fin[j]) - (proj[i] - proj[j]));
      }
    }
  }
}
const rms = (a: number[]) => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / a.length);
for (const [id, byLeft] of Object.entries(rows)) {
  console.log(id);
  for (const [left, b] of Object.entries(byLeft)) {
    console.log(`  left ${left.padStart(2)}  naive rms ${rms(b.naive).toFixed(2).padStart(6)} (per sqrt-gen ${(rms(b.naive) / Math.sqrt(+left)).toFixed(2)})  projected rms ${rms(b.proj).toFixed(2).padStart(6)} (per sqrt-gen ${(rms(b.proj) / Math.sqrt(+left)).toFixed(2)})  n ${b.naive.length}`);
  }
}
