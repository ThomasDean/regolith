// Small read-only helpers shared by the card catalogue and the engine.
import type { GameState, Player, Space, Tag } from './types';
import { CARDS } from './cards';
import { neighbours, onMars } from './board';

export const P = (s: GameState, pid: number): Player => s.players[pid];
export const space = (s: GameState, id: string): Space => s.board.find((x) => x.id === id)!;

/** Tags a player "has": corporation plus non-event cards in play. */
export function tagCount(s: GameState, pid: number, tag: Tag): number {
  const p = P(s, pid);
  let n = 0;
  const ids = p.corp ? [p.corp, ...p.played] : p.played;
  for (const id of ids) {
    const c = CARDS[id];
    if (c.type === 'event') continue;
    for (const t of c.tags) if (t === tag) n++;
  }
  return n;
}

export const eventsPlayed = (s: GameState, pid: number) => P(s, pid).played.filter((id) => CARDS[id].type === 'event').length;

export function cities(s: GameState, opts: { pid?: number; marsOnly?: boolean } = {}): Space[] {
  return s.board.filter((x) => x.tile && x.tile.kind === 'city' && (opts.pid === undefined || x.tile.owner === opts.pid) && (!opts.marsOnly || onMars(x)));
}
export const greeneries = (s: GameState, pid?: number) =>
  s.board.filter((x) => x.tile?.kind === 'greenery' && (pid === undefined || x.tile.owner === pid));
export const ownedTiles = (s: GameState, pid: number) => s.board.filter((x) => x.tile && x.tile.owner === pid);
export const marsTiles = (s: GameState, pid: number) => ownedTiles(s, pid).filter(onMars);

export function adjacentCount(s: GameState, id: string, pred: (x: Space) => boolean): number {
  return neighbours(s.board, id).filter(pred).length;
}

/** The space a card's tile sits on (Capital, Commercial District). */
export const cardSpace = (s: GameState, card: string) => s.board.find((x) => x.tile?.card === card);

export const others = (s: GameState, pid: number) => s.players.filter((p) => p.id !== pid);
