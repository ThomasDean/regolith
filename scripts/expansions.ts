// CPU games with expansions: winners, game length, and time per game.
// Usage: npx tsx scripts/expansions.ts normal,normal,hard 6 [prelude,venus,colonies,turmoil] [board]
import { playSeeded } from './sim';
import { score } from '../src/engine/queries';
import type { Expansions } from '../src/engine/types';
import type { BoardId } from '../src/engine/board';

const agents = (process.argv[2] ?? 'normal,normal,normal').split(',');
const games = Number(process.argv[3] ?? 4);
const ex: Expansions = Object.fromEntries((process.argv[4] ?? 'prelude,venus,colonies,turmoil').split(',').filter(Boolean).map((e) => [e, true]));
const board = (process.argv[5] ?? 'tharsis') as BoardId;
const wins: Record<string, number> = {};
let gens = 0, ms = 0, stuck = 0;
for (let g = 1; g <= games; g++) {
  const t0 = Date.now();
  const { s, seat } = playSeeded(agents, g, undefined, 20000, { expansions: ex, board });
  ms += Date.now() - t0;
  if (s.phase !== 'over') { stuck++; console.log(`game ${g} stuck in ${s.phase} gen ${s.generation}`, s.log.slice(-4).map((l) => l.text)); continue; }
  const sc = s.players.map((p) => score(s, p.id).total);
  const best = Math.max(...sc);
  sc.forEach((v, i) => { if (v === best) wins[seat[i]] = (wins[seat[i]] ?? 0) + 1; });
  gens += s.generation;
  console.log(`game ${g}: gen ${s.generation}, venus ${s.venus ?? '-'}, ${s.players.map((p, i) => `${p.name}/${p.corp} ${sc[i]} (TR ${p.tr}${p.fleets ? `, ${s.colonies!.reduce((a, c) => a + c.colonies.filter((o) => o === i).length, 0)} col` : ''})`).join(' · ')}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
console.log('wins', wins, 'avg gens', (gens / Math.max(1, games - stuck)).toFixed(1), 'avg s/game', (ms / games / 1000).toFixed(1), 'stuck', stuck);
