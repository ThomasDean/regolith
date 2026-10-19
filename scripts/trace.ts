// Per-generation trace of one seeded game with mixed agents (see scripts/sim.ts).
// Usage: tsx scripts/trace.ts <agents comma list> <seed> [fromGen]
import { playSeeded } from './sim';
import { score } from '../src/engine/queries';
import type { Action } from '../src/engine/types';

const agents = (process.argv[2] ?? 'normal,normal,normal').split(',');
const seed = Number(process.argv[3] ?? 1);
const from = Number(process.argv[4] ?? 1);
let gen = 0;
let acts: string[] = [];
const key = (a: Action) => (a.t === 'sp' ? `sp:${a.id}` : a.t === 'play' ? `play:${a.card}` : a.t === 'cardAction' ? `act:${a.card}` : a.t);
const { s } = playSeeded(agents, seed, (s, pid, a, seat) => {
  if (s.generation !== gen) {
    if (gen >= from) console.log('   ', acts.join(' '));
    gen = s.generation;
    acts = [];
    if (gen >= from) console.log(`gen ${gen} T ${s.temperature} O ${s.oxygen} Oc ${s.oceans} | ` + s.players.map((p) => `${seat[p.id]}/${p.corp}: vp ${score(s, p.id).total} mc ${p.res.mc} heat ${p.res.heat} pl ${p.res.plants} prod ${p.prod.mc}/${p.prod.heat} hand ${p.hand.length}`).join(' | '));
  }
  if (s.phase === 'action' && !s.prompt) acts.push(`${pid}:${key(a)}`);
});
console.log('   ', acts.join(' '));
console.log('final', s.phase, s.generation, s.players.map((p) => score(s, p.id).total));
