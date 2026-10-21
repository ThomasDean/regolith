// Dump (snapshot features -> final award metric) rows for calibrating the award projection model.
// Usage: tsx scripts/award-data.ts <agent> <seedStart> <count> > rows.jsonl
import { playSeeded } from './sim';
import { AWARDS } from '../src/engine/queries';
import { tagCount } from '../src/engine/helpers';
import type { GameState } from '../src/engine/types';

const agent = process.argv[2] ?? 'normal';
const start = Number(process.argv[3] ?? 1), count = Number(process.argv[4] ?? 20);
for (let g = start; g < start + count; g++) {
  const snaps: GameState[] = [];
  let last = 0;
  const { s: end } = playSeeded([agent, agent, agent], g, (s) => {
    if (s.phase === 'action' && !s.prompt && s.generation !== last) { last = s.generation; snaps.push(structuredClone({ ...s, log: [] })); }
  });
  for (const s of snaps) {
    for (const p of s.players) {
      const row: Record<string, number | string> = {
        game: g, pid: p.id, gen: s.generation, left: end.generation - s.generation + 1,
        steps: (8 - s.temperature) / 2 + (14 - s.oxygen) + (9 - s.oceans), temp: s.temperature,
        prodMc: p.prod.mc, prodSteel: p.prod.steel, prodTi: p.prod.titanium, prodHeat: p.prod.heat, prodEnergy: p.prod.energy, prodPlants: p.prod.plants,
        heat: p.res.heat, steel: p.res.steel, ti: p.res.titanium, plants: p.res.plants, sciHand: p.hand.filter((id) => id && false).length,
        sci: tagCount(s, p.id, 'science'),
      };
      for (const a of AWARDS) { row[`cur_${a.id}`] = a.metric(s, p.id); row[`fin_${a.id}`] = a.metric(end, p.id); }
      console.log(JSON.stringify(row));
    }
  }
}
