// Award-model calibration across maps: for every award in play on each map's own set, the RMS
// change of the gap between two players' metrics from a generation to the end, per sqrt(gens left).
// These are the `drift.sd` values on the award definitions. Usage: tsx scripts/award-drift-boards.ts [games=8]
import { playSeeded } from './sim';
import { BOARD_IDS } from '../src/engine/board';
import { gameAwards } from '../src/engine/ma';
import type { GameState } from '../src/engine/types';

const games = Number(process.argv[2] ?? 8);
const out = new Map<string, number[]>();
for (const board of BOARD_IDS) {
  for (let g = 1; g <= games; g++) {
    const snaps: GameState[] = [];
    let last = 0;
    const { s: end } = playSeeded(['normal', 'normal', 'normal'], g, (s) => {
      if (s.phase === 'action' && !s.prompt && s.generation !== last) { last = s.generation; snaps.push(structuredClone({ ...s, log: [], history: undefined })); }
    }, 8000, { board });
    for (const a of gameAwards(end)) {
      const fin = end.players.map((p) => a.metric(end, p.id));
      for (const s of snaps) {
        const left = end.generation - s.generation + 1;
        if (left < 2) continue;
        const cur = s.players.map((p) => a.metric(s, p.id));
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) (out.get(a.id) ?? out.set(a.id, []).get(a.id)!).push(((fin[i] - fin[j]) - (cur[i] - cur[j])) / Math.sqrt(left));
      }
    }
  }
}
for (const [id, xs] of out) {
  const rms = Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);
  const cur = gameAwards({ options: { corporateEra: true, seed: 0, awards: [id], milestones: [] } })[0].drift.sd;
  console.log(id.padEnd(15), 'fitted sd', rms.toFixed(2), ' current', cur, ' n', xs.length);
}
