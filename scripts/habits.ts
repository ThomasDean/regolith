import { createGame, applyAction } from '../src/engine/game';
import { cpuAction } from '../src/engine/ai/cpu';
const lvl = (process.argv[2] ?? 'normal') as any;
const tally = { bought: 0, offered: 0, played: 0, sold: 0, passMc: 0, passes: 0, sp: 0, setupKeep: 0 };
let players = 0;
for (let g = 1; g <= 4; g++) {
  let seedv = g * 31 + 5; const R = () => { seedv = (seedv * 16807) % 2147483647; return seedv / 2147483647; };
  let s = createGame([lvl, lvl, lvl].map((l: any, i) => ({ name: `P${i}`, color: '#000', cpu: l })), { seed: g + 500 });
  players += 3;
  while (s.phase !== 'over') {
    const pid = s.prompt ? s.prompt.pid : s.active;
    const a = cpuAction(s, lvl, R);
    if (a.t === 'research') { tally.bought += a.keep.length; tally.offered += 4; }
    if (a.t === 'setup') tally.setupKeep += a.keep.length;
    if (a.t === 'play') tally.played++;
    if (a.t === 'sp' && a.id === 'sell') tally.sold += a.cards!.length;
    if (a.t === 'sp' && a.id !== 'sell') tally.sp++;
    if (a.t === 'pass' && s.phase === 'action') { tally.passes++; tally.passMc += s.players[pid].res.mc; }
    s = applyAction(s, a);
  }
}
console.log({ perPlayer: Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, +(v / players).toFixed(1)])), avgMcAtPass: (tally.passMc / tally.passes).toFixed(1) });
