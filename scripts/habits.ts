// Behaviour profile of CPU players over many seeded games.
// Usage: tsx scripts/habits.ts <agents comma list> <seedStart> <count> [--json]
//   agents: easy | normal | hard | old-easy | old-normal | old-hard (old-* = frozen pre-rework evaluator)
// Example: tsx scripts/habits.ts normal,normal,normal 1 30
import { playSeeded, type Agent } from './sim';
import { AWARDS, awardCost, awardPlaces, canClaimMilestone, MILESTONES, score } from '../src/engine/queries';
import { CARDS } from '../src/engine/cards';
import type { GameState } from '../src/engine/types';

const agents = (process.argv[2] ?? 'normal,normal,normal').split(',');
const start = Number(process.argv[3] ?? 1), count = Number(process.argv[4] ?? 10);
const asJson = process.argv.includes('--json');

interface Stat {
  players: number; games: number; wins: number;
  awards: { gen: number; cost: number; margin: number; won: boolean; second: boolean; id: string }[];
  milestones: { gen: number; id: string }[];
  sp: Record<string, number[]>; // project -> gens used
  sold: number; sellActs: number;
  heat: number[]; plants: number[];
  plays: Record<number, number>; actions: Record<number, number>; research: Record<number, number>; resOffers: Record<number, number>;
  passMc: number[]; passGen: number[]; richPass: number; missedMs: number; // passes with >= 15 M€ outside the last generation
  prodByGen: Record<number, number[]>; // M€ income (TR + M€ prod) at the start of each action phase
  gens: number[]; vp: Record<string, number[]>; endHand: number[]; bought: number; setupKept: number;
  corps: Record<string, number>; corpOffers: Record<string, number>; corpWins: Record<string, number>; corpVp: Record<string, number[]>;
  firstPlays: Record<string, number>; firstActionKind: Record<string, number>;
}
const blank = (): Stat => ({
  players: 0, games: 0, wins: 0, awards: [], milestones: [], sp: {}, sold: 0, sellActs: 0, heat: [], plants: [],
  plays: {}, actions: {}, research: {}, resOffers: {}, passMc: [], passGen: [], richPass: 0, missedMs: 0, prodByGen: {}, gens: [], vp: {}, endHand: [], bought: 0, setupKept: 0,
  corps: {}, corpOffers: {}, corpWins: {}, corpVp: {}, firstPlays: {}, firstActionKind: {},
});
const stats: Record<Agent, Stat> = {};
const inc = (o: Record<string | number, number>, k: string | number, n = 1) => { o[k] = (o[k] ?? 0) + n; };

for (let g = start; g < start + count; g++) {
  const pendingAwards: { pid: number; gen: number; cost: number; margin: number; id: string }[] = [];
  let lastGen = 0;
  let firstDone = new Set<number>();
  let seatRef: Agent[] = [];
  const onAction = (s: GameState, pid: number, a: import('../src/engine/types').Action, seat: Agent[]) => {
    seatRef = seat;
    const st = (stats[seat[pid]] ??= blank());
    if (s.phase === 'action' && !s.prompt && s.generation !== lastGen) {
      lastGen = s.generation;
      for (const q of s.players) ((stats[seat[q.id]] ??= blank()).prodByGen[s.generation] ??= []).push(q.tr + q.prod.mc);
    }
    if (a.t === 'setup') {
      inc(st.corps, a.corp);
      st.setupKept += a.keep.length;
      for (const c of s.players[pid].setup!.corps) if (c !== 'beginner-corporation') inc(st.corpOffers, c);
      return;
    }
    if (a.t === 'research') { st.bought += a.keep.length; inc(st.research, s.generation, a.keep.length); inc(st.resOffers, s.generation); return; }
    if (s.phase !== 'action' || s.prompt) return;
    if (a.t !== 'pass' && a.t !== 'endTurn') {
      inc(st.actions, s.generation);
      if (s.generation === 1 && !firstDone.has(pid)) {
        firstDone.add(pid);
        inc(st.firstActionKind, a.t === 'sp' ? `sp:${a.id}` : a.t);
        if (a.t === 'play') inc(st.firstPlays, CARDS[a.card].name);
      }
    }
    switch (a.t) {
      case 'play': inc(st.plays, s.generation); break;
      case 'award': {
        const def = AWARDS.find((x) => x.id === a.id)!;
        const mine = def.metric(s, pid);
        const best = Math.max(...s.players.filter((q) => q.id !== pid).map((q) => def.metric(s, q.id)));
        pendingAwards.push({ pid, gen: s.generation, cost: awardCost(s), margin: mine - best, id: a.id });
        break;
      }
      case 'milestone': st.milestones.push({ gen: s.generation, id: a.id }); break;
      case 'sp':
        if (a.id === 'sell') { st.sold += a.cards?.length ?? 0; st.sellActs++; }
        else (st.sp[a.id] ??= []).push(s.generation);
        break;
      case 'heat': st.heat.push(s.generation); break;
      case 'plants': st.plants.push(s.generation); break;
      case 'endTurn':
        if (MILESTONES.some((m) => canClaimMilestone(s, pid, m.id))) st.missedMs++;
        break;
      case 'pass': {
        if (MILESTONES.some((m) => canClaimMilestone(s, pid, m.id))) st.missedMs++;
        const mc = s.players[pid].res.mc;
        st.passMc.push(mc); st.passGen.push(s.generation);
        // "last generation" approximated: any global parameter left with few steps
        const left = (8 - s.temperature) / 2 + (14 - s.oxygen) + (9 - s.oceans);
        if (mc >= 15 && left > 6) st.richPass++;
        break;
      }
    }
  };
  const { s } = playSeeded(agents, g, onAction);
  if (s.phase !== 'over') { console.log('STALL', g); continue; }
  const totals = s.players.map((p) => score(s, p.id).total);
  const best = Math.max(...totals);
  for (const p of s.players) {
    const st = stats[seatRef[p.id]];
    st.players++;
    st.gens.push(s.generation);
    st.endHand.push(p.hand.length);
    if (totals[p.id] === best) { st.wins++; inc(st.corpWins, p.corp!); }
    (st.corpVp[p.corp!] ??= []).push(totals[p.id]);
    const sc = score(s, p.id);
    for (const k of ['tr', 'cards', 'greeneries', 'cities', 'awards', 'milestones', 'total'] as const) (st.vp[k] ??= []).push(sc[k]);
  }
  for (const pa of pendingAwards) {
    const pl = awardPlaces(s, pa.id);
    stats[seatRef[pa.pid]].awards.push({ gen: pa.gen, cost: pa.cost, margin: pa.margin, id: pa.id, won: pl.first.includes(pa.pid), second: pl.second.includes(pa.pid) });
  }
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const hist = (gens: number[], lo = 1, hi = 14) => {
  const out: number[] = [];
  for (let g = lo; g <= hi; g++) out.push(gens.filter((x) => (g === hi ? x >= g : x === g)).length);
  return out.join(' ');
};

const summary: Record<string, unknown> = {};
for (const [agent, st] of Object.entries(stats)) {
  const n = st.players;
  const aw = st.awards;
  const early = aw.filter((x) => x.gen <= 5).length;
  const sum = {
    players: n, winRate: st.wins / n, avgGen: avg(st.gens),
    vp: Object.fromEntries(Object.entries(st.vp).map(([k, v]) => [k, +avg(v).toFixed(1)])),
    awardsPerPlayer: aw.length / n, awardAvgGen: avg(aw.map((x) => x.gen)), awardsByGen1to5: early / Math.max(1, aw.length),
    awardFunderWins: aw.filter((x) => x.won).length / Math.max(1, aw.length), awardFunderSecond: aw.filter((x) => x.second).length / Math.max(1, aw.length),
    awardMarginAtFunding: avg(aw.map((x) => x.margin)), awardCostAvg: avg(aw.map((x) => x.cost)),
    milestonesPerPlayer: st.milestones.length / n, missedMilestoneTurns: st.missedMs / n, milestoneAvgGen: avg(st.milestones.map((x) => x.gen)),
    spPerPlayer: Object.fromEntries(Object.entries(st.sp).map(([k, v]) => [k, +(v.length / n).toFixed(2)])),
    spAvgGen: Object.fromEntries(Object.entries(st.sp).map(([k, v]) => [k, +avg(v).toFixed(1)])),
    soldPerPlayer: st.sold / n, heatConvPerPlayer: st.heat.length / n, plantConvPerPlayer: st.plants.length / n,
    mcAtPass: avg(st.passMc), richPassesPerPlayer: st.richPass / n,
  };
  summary[agent] = sum;
  if (asJson) continue;
  console.log(`\n=== ${agent}  (${n} player-games, win ${f(100 * sum.winRate, 0)}%, ${f(sum.avgGen)} gens) ===`);
  console.log('Final VP     ', Object.entries(sum.vp).map(([k, v]) => `${k} ${v}`).join(' | '));
  console.log(`Awards       ${f(sum.awardsPerPlayer, 2)}/player, avg gen ${f(sum.awardAvgGen)}, ${f(100 * sum.awardsByGen1to5, 0)}% in gens 1-5, ` +
    `funder wins ${f(100 * sum.awardFunderWins, 0)}% (2nd ${f(100 * sum.awardFunderSecond, 0)}%), lead when funding ${f(sum.awardMarginAtFunding)}, avg cost ${f(sum.awardCostAvg)}`);
  console.log(`  by gen     ${hist(aw.map((x) => x.gen))}   (gens 1..14+)`);
  const byId: Record<string, number> = {};
  for (const x of aw) inc(byId, x.id);
  console.log('  which      ', JSON.stringify(byId));
  console.log(`Milestones   ${f(sum.milestonesPerPlayer, 2)}/player, avg gen ${f(sum.milestoneAvgGen)}; by gen ${hist(st.milestones.map((x) => x.gen))}; turns ended while able to claim ${f(sum.missedMilestoneTurns, 2)}/player`);
  const mid: Record<string, number> = {};
  for (const x of st.milestones) inc(mid, x.id);
  console.log('  which      ', JSON.stringify(mid));
  console.log('Std projects ', Object.entries(st.sp).map(([k, v]) => `${k} ${f(v.length / n, 2)} (gen ${f(avg(v))})`).join(' | '), `| sold ${f(st.sold / n, 1)} cards in ${f(st.sellActs / n, 1)} acts`);
  for (const [k, v] of Object.entries(st.sp)) console.log(`  sp ${k.padEnd(9)} by gen ${hist(v)}`);
  console.log(`Conversions  heat ${f(st.heat.length / n, 1)} (by gen ${hist(st.heat)}) | plants ${f(st.plants.length / n, 1)} (by gen ${hist(st.plants)})`);
  const gl = Array.from({ length: 14 }, (_, i) => i + 1);
  console.log('Per gen      gen    ', gl.map((g) => String(g).padStart(5)).join(''));
  console.log('             income ', gl.map((g) => f(avg(st.prodByGen[g] ?? [])).padStart(5)).join(''));
  console.log('             plays  ', gl.map((g) => f((st.plays[g] ?? 0) / n, 2).padStart(5)).join(''));
  console.log('             actions', gl.map((g) => f((st.actions[g] ?? 0) / n, 1).padStart(5)).join(''));
  console.log('             buys   ', gl.map((g) => f((st.research[g] ?? 0) / Math.max(1, st.resOffers[g] ?? 0), 2).padStart(5)).join(''));
  console.log(`Cards        kept ${f(st.setupKept / n)} at setup, bought ${f(st.bought / n)} in research, left in hand at the end ${f(avg(st.endHand))}`);
  console.log(`Passing      avg M€ at pass ${f(sum.mcAtPass)}, passes with >=15 M€ before the endgame ${f(sum.richPassesPerPlayer, 2)}/player`);
  const top = (o: Record<string, number>, k = 6) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, v]) => `${x} ${v}`).join(', ');
  console.log('Corp picks   ', Object.entries(st.corps).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${v}/${st.corpOffers[c] ?? 0}`).join(', '));
  console.log('Corp results ', Object.entries(st.corpVp).sort((a, b) => b[1].length - a[1].length).map(([c, v]) => `${c} ${st.corpWins[c] ?? 0}/${v.length}w ${f(avg(v))}vp`).join(', '));
  console.log('Gen-1 first action', top(st.firstActionKind), '| first card', top(st.firstPlays, 5));
}
if (asJson) console.log(JSON.stringify(summary));
