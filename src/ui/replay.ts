// Catch-up replay: rebuilds what the table looked like before recent log entries by undoing
// the changes each entry recorded (resources, production, TR, card resources, cards played,
// tiles, global parameters, milestones and awards), then steps forward through them so the
// usual effects play: card showcases, tile drops, number floats and banners.
import type { GameState, LogFx } from '../engine/types';
import { RESOURCES } from '../engine/types';

function revert(s: GameState, fx: LogFx): GameState {
  const placed = new Set((fx.tiles ?? []).map((t) => t.space));
  const players = s.players.map((p) => {
    const e = fx.p?.find((x) => x.pid === p.id);
    if (!e) return p;
    const q = { ...p, res: { ...p.res }, prod: { ...p.prod }, cardRes: { ...p.cardRes }, played: [...p.played] };
    for (const r of RESOURCES) {
      if (e.res?.[r]) q.res[r] -= e.res[r]!;
      if (e.prod?.[r]) q.prod[r] -= e.prod[r]!;
    }
    if (e.tr) q.tr -= e.tr;
    for (const [id, n] of Object.entries(e.cards ?? {})) q.cardRes[id] = (q.cardRes[id] ?? 0) - n;
    for (const id of [...(e.played ?? [])].reverse()) {
      const i = q.played.lastIndexOf(id);
      if (i >= 0) q.played.splice(i, 1);
    }
    if (e.corp) q.corp = null;
    if (e.passed !== undefined) q.passed = !e.passed;
    return q;
  });
  const dropIds = (list: { id: string; pid: number }[], gone?: { id: string }[]) => (gone?.length ? list.filter((x) => !gone.some((g) => g.id === x.id)) : list);
  return {
    ...s,
    players,
    board: placed.size ? s.board.map((sp) => (placed.has(sp.id) ? { ...sp, tile: undefined } : sp)) : s.board,
    temperature: s.temperature - (fx.temp ?? 0),
    oxygen: s.oxygen - (fx.oxy ?? 0),
    oceans: s.oceans - (fx.ocean ?? 0),
    venus: s.venus !== undefined ? s.venus - (fx.venus ?? 0) : undefined,
    milestones: dropIds(s.milestones, fx.milestones),
    awards: dropIds(s.awards, fx.awards),
    phase: fx.phase ?? s.phase,
    generation: fx.gen ?? s.generation,
  };
}

export interface Replay {
  /** frames[0] is the table before the first replayed entry; frames[k] is after entry k-1 */
  frames: GameState[];
  /** log index of the first replayed entry */
  from: number;
}

/** Frames for replaying log entries from index `from` to the end of the log. */
export function buildReplay(live: GameState, from: number): Replay {
  const m = live.log.length - from;
  const frames: GameState[] = new Array(m + 1);
  // between moves nobody is being asked anything: hide prompts while replaying
  let cur: GameState = { ...live, prompt: null };
  frames[m] = cur;
  for (let k = m; k >= 1; k--) {
    const fx = live.log[from + k - 1].fx;
    cur = fx ? revert(cur, fx) : cur;
    frames[k - 1] = cur;
  }
  for (let k = 0; k <= m; k++) frames[k] = { ...frames[k], log: live.log.slice(0, from + k) };
  return { frames, from };
}

/**
 * Where a catch-up replay should start for this player: just after their own latest move, so
 * it shows what everyone else did since. With nothing since, the last few entries.
 */
export function replayStart(s: GameState, viewer: number | null): number {
  const log = s.log;
  let j = -1;
  if (viewer !== null) for (let k = log.length - 1; k >= 0; k--) if (log[k].pid === viewer) { j = k; break; }
  let i = j + 1;
  if (j < 0 || i >= log.length) i = Math.max(0, log.length - 8);
  // a long gap: keep it to the latest 40 entries
  return Math.max(i, log.length - 40);
}

const SEEN_KEY = 'regolith-seen:';
/** The newest log entry this device has shown for a game (by running number). */
export function loadSeen(key: string): number | null {
  try { const v = localStorage.getItem(SEEN_KEY + key); return v === null ? null : Number(v); } catch { return null; }
}
export function saveSeen(key: string, n: number) {
  try { localStorage.setItem(SEEN_KEY + key, String(n)); } catch { /* storage unavailable */ }
}
