// Premoves: moves a player queues while waiting, made for them when their turn comes. A queued
// pass passes; a queued card action is used if it still can be (else skipped). They run only
// in the action phase and only for the generation they were queued in. A step that needs a
// choice (where a tile goes, which option) stops there and leaves it to the player.
import type { Action, GameState, Premove } from './types';
import { CARDS } from './cards';
import { autoPay, cardActionAvailable } from './queries';
import { applyActionLogged } from './game';

const MAX = 8;

/** Validates and stores a player's queue (an empty list clears it). Throws on a bad list. */
export function setPremoves(s: GameState, pid: number, list: unknown): void {
  if (!Array.isArray(list) || list.length > MAX) throw new Error('Bad premove list');
  const clean: Premove[] = [];
  for (const m of list as Premove[]) {
    if (m?.t === 'pass') clean.push({ t: 'pass' });
    else if (m?.t === 'cardAction' && typeof m.card === 'string' && CARDS[m.card]?.action) clean.push({ t: 'cardAction', card: m.card });
    else throw new Error('Bad premove');
  }
  // nothing after a pass can happen this generation
  const cut = clean.findIndex((m) => m.t === 'pass');
  const kept = cut >= 0 ? clean.slice(0, cut + 1) : clean;
  if (!kept.length) { if (s.premoves) delete s.premoves[pid]; return; }
  (s.premoves ??= {})[pid] = { gen: s.generation, list: kept };
}

/** A player's queue as it stands (stale ones from earlier generations read as empty). */
export function premovesOf(s: GameState, pid: number): Premove[] {
  const q = s.premoves?.[pid];
  return q && q.gen === s.generation ? q.list : [];
}

/** Makes queued moves for whoever is up, as long as they have some. Returns what it played. */
export function runPremoves(s: GameState): { seat: number; a: Action }[] {
  const done: { seat: number; a: Action }[] = [];
  for (let guard = 0; guard < 2 * MAX + 4; guard++) {
    if (s.phase !== 'action' || s.prompt || s.pendingAction || !s.premoves) break;
    const pid = s.active;
    const q = s.premoves[pid];
    if (!q) break;
    if (q.gen !== s.generation || s.players[pid].cpu || s.players[pid].passed) { delete s.premoves[pid]; break; }
    const m = q.list.shift();
    if (!q.list.length) delete s.premoves[pid];
    if (!m) break;
    let a: Action;
    if (m.t === 'pass') {
      a = { t: 'pass' };
      delete s.premoves[pid];
    } else {
      if (!cardActionAvailable(s, pid, m.card)) continue;
      const act = CARDS[m.card].action!;
      const pay = act.mc ? autoPay(s, pid, act.mc, { steel: !!act.steel, titanium: !!act.titanium, heat: false }) ?? undefined : undefined;
      a = { t: 'cardAction', card: m.card, pay };
    }
    try {
      applyActionLogged(s, a);
      done.push({ seat: pid, a });
    } catch { /* no longer possible: skip it */ }
  }
  if (s.premoves && !Object.keys(s.premoves).length) delete s.premoves;
  return done;
}
