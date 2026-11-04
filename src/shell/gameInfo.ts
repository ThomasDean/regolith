// The games on the site. Kept free of game code so the hub stays small; each game's screens
// load only when it's opened (see Root.tsx).
export type GameId = 'regolith' | 'fathom';

export interface GameInfo {
  id: GameId;
  name: string;
  path: string;
  /** what it's based on, in plain words */
  kind: string;
  blurb: string;
  players: string;
  minutes: string;
  online: boolean;
}

export const GAME_INFO: Record<GameId, GameInfo> = {
  regolith: {
    id: 'regolith', name: 'Regolith', path: '/regolith', kind: 'Terraforming Mars',
    blurb: 'Raise the temperature, oxygen and oceans of a red planet while building a corporate engine of cards.',
    players: '2–5', minutes: '90–150', online: true,
  },
  fathom: {
    id: 'fathom', name: 'Fathom', path: '/fathom', kind: 'Finspan',
    blurb: 'Stock your own stretch of ocean with fish, from the sunlit shallows to the midnight deep, then send divers down to set it working.',
    players: '1–5', minutes: '40–70', online: true,
  },
};

export const GAME_LIST: GameInfo[] = [GAME_INFO.regolith, GAME_INFO.fathom];
