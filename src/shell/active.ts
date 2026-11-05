// Every game you have going, across all games: hotseat games saved in this browser and online
// games on the server. The hub lists them, and the in-game "next game" button picks from them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { regolithSaves, migrateLegacySave } from '../ui/saves';
import { fathomSaves } from '../fathom/saves';
import { myRooms, onlineEnabled } from '../online/client';
import { fathomRooms } from '../fathom/online/client';
import { mySeat, roomWaitsOn, type BaseRoom } from './rooms';
import { SAVES_EVENT, type LocalStore } from './localSaves';
import { GAME_INFO, type GameId } from './gameInfo';

export interface ActiveGame {
  /** unique across games, e.g. `regolith:room:<id>` */
  key: string;
  game: GameId;
  kind: 'local' | 'online';
  href: string;
  title: string;
  players: string;
  /** the game is waiting on you (hotseat games always are: they only move while open) */
  yourMove: boolean;
  lobby: boolean;
  updated: number;
}

const LOCAL: { game: GameId; store: LocalStore<unknown> }[] = [
  { game: 'regolith', store: regolithSaves as LocalStore<unknown> },
  { game: 'fathom', store: fathomSaves as LocalStore<unknown> },
];

export function localActive(): ActiveGame[] {
  migrateLegacySave();
  return LOCAL.flatMap(({ game, store }) => store.list().filter((m) => !m.over).map((m) => ({
    key: `${game}:local:${m.id}`, game, kind: 'local' as const, href: `${GAME_INFO[game].path}?local=${m.id}`,
    title: m.title, players: m.players, yourMove: true, lobby: false, updated: m.updated,
  })));
}

export { mySeat, roomWaitsOn };

/** An online room of either game, tagged with its game. */
export type AnyRoom = BaseRoom & { game: GameId; generation?: number | null; tide?: number | null };

export function onlineActive(rooms: AnyRoom[], uid: string): ActiveGame[] {
  return rooms.filter((r) => {
    const i = mySeat(r, uid);
    if (r.status === 'over') return false;
    // a game you forfeited is no longer yours to play
    if (i >= 0 && r.seats[i].forfeited) return false;
    return i >= 0 || r.host === uid;
  }).map((r) => ({
    key: `${r.game}:room:${r.id}`, game: r.game, kind: 'online' as const, href: `${GAME_INFO[r.game].path}?room=${r.id}`,
    title: r.status === 'lobby' ? `Lobby ${r.code}` : r.game === 'fathom' ? `Tide ${r.tide ?? 1} of 4 · online` : `Generation ${r.generation ?? 1} · online`,
    players: r.seats.map((x) => x.name || 'open seat').join(', '),
    yourMove: roomWaitsOn(r, uid), lobby: r.status === 'lobby', updated: new Date(r.updated_at).getTime(),
  }));
}

/** Every online room you're in, across games. A game whose server isn't set up yet just adds nothing. */
export async function allRooms(): Promise<AnyRoom[]> {
  const [a, b] = await Promise.all([
    myRooms().then((xs) => xs.map((r) => ({ ...r, game: 'regolith' as const })), () => [] as AnyRoom[]),
    fathomRooms.myRooms().then((xs) => xs.map((r) => ({ ...r, game: 'fathom' as const })), () => [] as AnyRoom[]),
  ]);
  return [...a, ...b];
}

/**
 * Order for the list and for "next game": games waiting on you first (online before hotseat,
 * since friends are waiting on those; the longest-waiting first), then everything else, newest first.
 */
export function sortActive(xs: ActiveGame[]): ActiveGame[] {
  const rank = (g: ActiveGame) => (g.yourMove ? (g.kind === 'online' ? 0 : 1) : 2);
  return [...xs].sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? a.updated - b.updated : b.updated - a.updated));
}

/** The game to go to after this one: the first other game that's waiting on you. */
export function nextGame(xs: ActiveGame[], current: string | null): ActiveGame | null {
  return sortActive(xs).find((g) => g.yourMove && !g.lobby && g.key !== current) ?? null;
}

const POLL_MS = 30_000;

/**
 * All active games, kept fresh: local saves whenever the index changes, online rooms on a slow
 * poll, when the app comes back to the foreground, and when `bump` changes (e.g. you just moved).
 */
export function useActiveGames(uid: string | undefined | null, bump: unknown = 0): { games: ActiveGame[]; loaded: boolean; refresh: () => void } {
  const [local, setLocal] = useState<ActiveGame[]>(localActive);
  const [rooms, setRooms] = useState<AnyRoom[] | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => { setLocal(localActive()); setTick((t) => t + 1); }, []);

  useEffect(() => {
    const onSaves = () => setLocal(localActive());
    const wake = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(SAVES_EVENT, onSaves);
    document.addEventListener('visibilitychange', wake);
    const t = setInterval(() => setTick((x) => x + 1), POLL_MS);
    return () => { window.removeEventListener(SAVES_EVENT, onSaves); document.removeEventListener('visibilitychange', wake); clearInterval(t); };
  }, [refresh]);

  useEffect(() => {
    if (!uid || !onlineEnabled) { setRooms([]); return; }
    let live = true;
    // a short delay after a move lets the server's room row catch up
    const t = setTimeout(() => allRooms().then((r) => { if (live) setRooms(r); }, () => { if (live) setRooms((x) => x ?? []); }), 600);
    return () => { live = false; clearTimeout(t); };
  }, [uid, tick, bump]);

  const games = useMemo(() => sortActive([...local, ...(uid && rooms ? onlineActive(rooms, uid) : [])]), [local, rooms, uid]);
  return { games, loaded: rooms !== null, refresh };
}
