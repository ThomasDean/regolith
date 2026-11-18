// Records what each step changed onto the log, so screens can show a detailed log and replay
// recent moves. Only public information goes in: resources, production, TR, card resources,
// cards put into play, tiles, global parameters, milestones and awards.
import type { GameState, LogEntry, LogFx, Phase, Res } from './types';
import { RESOURCES } from './types';

interface Snap {
  players: { res: Record<Res, number>; prod: Record<Res, number>; tr: number; cardRes: Record<string, number>; played: number; corp: string | null; passed: boolean }[];
  tiles: Set<string>;
  temp: number; oxy: number; ocean: number; venus?: number;
  milestones: number; awards: number;
  phase: Phase; gen: number;
  last: LogEntry | undefined;
}

function snap(s: GameState): Snap {
  return {
    players: s.players.map((p) => ({ res: { ...p.res }, prod: { ...p.prod }, tr: p.tr, cardRes: { ...p.cardRes }, played: p.played.length, corp: p.corp, passed: p.passed })),
    tiles: new Set(s.board.filter((x) => x.tile).map((x) => x.id)),
    temp: s.temperature, oxy: s.oxygen, ocean: s.oceans, venus: s.venus,
    milestones: s.milestones.length, awards: s.awards.length,
    phase: s.phase, gen: s.generation,
    last: s.log[s.log.length - 1],
  };
}

function diff(a: Snap, s: GameState): LogFx | null {
  const fx: LogFx = {};
  const ps: NonNullable<LogFx['p']> = [];
  for (const p of s.players) {
    const q = a.players[p.id];
    if (!q) continue;
    const e: NonNullable<LogFx['p']>[number] = { pid: p.id };
    for (const r of RESOURCES) {
      if (p.res[r] !== q.res[r]) (e.res ??= {})[r] = p.res[r] - q.res[r];
      if (p.prod[r] !== q.prod[r]) (e.prod ??= {})[r] = p.prod[r] - q.prod[r];
    }
    if (p.tr !== q.tr) e.tr = p.tr - q.tr;
    for (const id of new Set([...Object.keys(p.cardRes), ...Object.keys(q.cardRes)])) {
      const d = (p.cardRes[id] ?? 0) - (q.cardRes[id] ?? 0);
      if (d) (e.cards ??= {})[id] = d;
    }
    if (p.played.length > q.played) e.played = p.played.slice(q.played);
    if (p.corp && p.corp !== q.corp) e.corp = p.corp;
    if (p.passed !== q.passed) e.passed = p.passed;
    if (Object.keys(e).length > 1) ps.push(e);
  }
  if (ps.length) fx.p = ps;
  const tiles = s.board.filter((x) => x.tile && !a.tiles.has(x.id)).map((x) => ({ space: x.id, kind: x.tile!.kind, owner: x.tile!.owner }));
  if (tiles.length) fx.tiles = tiles;
  if (s.temperature !== a.temp) fx.temp = s.temperature - a.temp;
  if (s.oxygen !== a.oxy) fx.oxy = s.oxygen - a.oxy;
  if (s.oceans !== a.ocean) fx.ocean = s.oceans - a.ocean;
  if (s.venus !== undefined && a.venus !== undefined && s.venus !== a.venus) fx.venus = s.venus - a.venus;
  if (s.milestones.length > a.milestones) fx.milestones = s.milestones.slice(a.milestones).map((m) => ({ ...m }));
  if (s.awards.length > a.awards) fx.awards = s.awards.slice(a.awards).map((m) => ({ ...m }));
  if (s.phase !== a.phase || s.generation !== a.gen) { fx.phase = a.phase; fx.gen = a.gen; }
  return Object.keys(fx).length ? fx : null;
}

/**
 * Runs one step (mutating s) and writes what it changed onto the log: onto the production entry
 * when a generation ended, else onto the first entry this step logged, else onto a new entry.
 */
export function recordStep(s: GameState, actor: number, step: () => void): void {
  const a = snap(s);
  step();
  const fx = diff(a, s);
  if (!fx) return;
  const from = a.last ? s.log.lastIndexOf(a.last) + 1 : 0;
  const fresh = s.log.slice(from);
  const target = fresh.find((l) => l.kind === 'production') ?? fresh.find((l) => l.pid !== null) ?? fresh[0];
  if (target && !target.fx) { target.fx = fx; return; }
  const last = s.log[s.log.length - 1];
  s.log.push({ gen: a.gen, pid: actor, text: '', n: (last?.n ?? s.log.length - 1) + 1, fx });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}
