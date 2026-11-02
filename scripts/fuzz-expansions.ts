// Random-move games over every combination of expansions: they must finish, keep resources
// non-negative, and leave the board consistent. Usage: npx tsx scripts/fuzz-expansions.ts [games per combo]
import { createGame, applyActionMut } from '../src/engine/game';
import { randomAction } from '../src/engine/bot';
import { EXPANSIONS, RESOURCES, type Expansions } from '../src/engine/types';
import { BOARD_IDS } from '../src/engine/board';

function rng(seed: number) { let t = seed; return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const per = Number(process.argv[2] ?? 3);
let games = 0, fails = 0;
const played = new Set<string>();
for (let mask = 1; mask < 16; mask++) {
  const ex: Expansions = Object.fromEntries(EXPANSIONS.filter((_, i) => mask & (1 << i)).map((e) => [e, true]));
  for (let g = 0; g < per; g++) {
    const seed = mask * 1000 + g;
    const n = 2 + (g % 4);
    const s = createGame(Array.from({ length: n }, (_, i) => ({ name: `P${i}`, color: '#000', cpu: null })), { seed, board: BOARD_IDS[(mask + g) % BOARD_IDS.length], expansions: ex });
    const r = rng(seed);
    let steps = 0;
    try {
      while (s.phase !== 'over' && steps < 60000) {
        const a = randomAction(s, r);
        if (a.t === 'play' || a.t === 'prelude') played.add(a.card);
        applyActionMut(s, a);
        steps++;
        for (const p of s.players) for (const k of RESOURCES) {
          if (p.res[k] < 0 || p.prod[k] < (k === 'mc' ? -5 : 0)) throw new Error(`${p.name} ${k} ${p.res[k]}/${p.prod[k]}`);
        }
        for (const p of s.players) for (const [c, v] of Object.entries(p.cardRes)) if (v < 0) throw new Error(`negative resources on ${c}`);
        if (s.board.filter((x) => x.tile?.kind === 'ocean').length !== s.oceans) throw new Error('ocean count drifted');
        if (s.turmoil) {
          const t = s.turmoil;
          for (const p of s.players) {
            const out = Object.values(t.parties).reduce((a, ps) => a + ps.delegates.filter((d) => d === p.id).length, 0) + (t.chairman === p.id ? 1 : 0);
            if (out + t.reserve[p.id] !== 7) throw new Error(`delegates of ${p.name}: ${out} out + ${t.reserve[p.id]} reserve`);
          }
        }
      }
      if (s.phase !== 'over') throw new Error(`stuck in ${s.phase} gen ${s.generation} after ${steps} steps`);
    } catch (e) {
      fails++;
      console.log(`FAIL ${JSON.stringify(ex)} seed ${seed} gen ${s.generation} phase ${s.phase}: ${(e as Error).message}`);
      console.log((e as Error).stack?.split('\n').slice(1, 6).join('\n'));
      console.log('prompt', JSON.stringify(s.prompt)?.slice(0, 300), 'last log', s.log.slice(-3).map((l) => l.text));
    }
    games++;
  }
}
console.log(`${games} games, ${fails} failures, ${played.size} distinct cards played`);
