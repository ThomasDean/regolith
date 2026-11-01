// CPU games on every map: completion, length, scores, and who claims what.
// Usage: tsx scripts/boards.ts [agents=normal,normal,normal] [games per board=3] [random M&A: 1]
import { playSeeded } from './sim';
import { BOARD_IDS, type BoardId } from '../src/engine/board';
import { score } from '../src/engine/queries';
import { drawMA, setupRandom } from '../src/engine/ma';

const agents = (process.argv[2] ?? 'normal,normal,normal').split(',');
const games = Number(process.argv[3] ?? 3);
const random = process.argv[4] === '1';
const boards = (process.env.BOARDS?.split(',') as BoardId[] | undefined) ?? BOARD_IDS;
for (const board of boards) {
  const rows: string[] = [];
  let gens = 0, ms = 0, ws = 0, vp = 0, t0 = Date.now();
  for (let g = 1; g <= games; g++) {
    const ma = random ? drawMA(board, { milestones: Array(5).fill(null), awards: Array(5).fill(null) }, setupRandom(g * 31)) : {};
    const { s, steps } = playSeeded(agents, g, undefined, 8000, { board, ...ma });
    if (s.phase !== 'over') { rows.push(`  game ${g}: STUCK after ${steps} steps in ${s.phase} gen ${s.generation}`); continue; }
    gens += s.generation; ms += s.milestones.length; ws += s.awards.length;
    const sc = s.players.map((p) => score(s, p.id).total);
    vp += sc.reduce((a, b) => a + b, 0) / sc.length;
    rows.push(`  game ${g}: ${s.generation} gens, VP ${sc.join('/')}, milestones ${s.milestones.map((m) => m.id).join(',') || '-'}, awards ${s.awards.map((a) => a.id).join(',') || '-'}, history ${s.history?.length}`);
  }
  console.log(`${board}: avg ${(gens / games).toFixed(1)} gens, ${(vp / games).toFixed(1)} VP, ${(ms / games).toFixed(1)} milestones, ${(ws / games).toFixed(1)} awards, ${((Date.now() - t0) / games / 1000).toFixed(1)} s/game`);
  for (const r of rows) console.log(r);
}
