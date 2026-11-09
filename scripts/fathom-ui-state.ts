// Plays a Fathom game with CPUs and prints the state as JSON, for screenshots: by default up to the
// last diver of a tide (so the page shows the end-of-tide count), with `mine` up to the human
// seat's first free turn in that tide. Usage: npx tsx scripts/fathom-ui-state.ts [tide] [variable] [mine]
import { applyAction, createGame, decider } from '../src/fathom/engine/game';
import { cpuAction } from '../src/fathom/engine/cpu';

const tide = Number(process.argv[2] ?? 1);
const variable = process.argv.includes('variable');
const mine = process.argv.includes('mine');
let s = createGame([
  { name: 'You', color: '#e2715f', cpu: null },
  { name: 'Marina', color: '#4aa3df', cpu: 'normal' },
  { name: 'Coral', color: '#58b368', cpu: 'hard' },
], { seed: 42, variable });
for (let i = 0; i < 2000; i++) {
  const left = s.players.reduce((n, p) => n + p.divers, 0);
  const free = !s.prompt && s.acting === null;
  if (s.tide === tide && free && (mine ? decider(s) === 0 : left === 1)) break;
  s = applyAction(s, cpuAction(s, 'normal'));
}
process.stdout.write(JSON.stringify(s));
