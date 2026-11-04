// Fathom games saved in this browser (any number at once).
import type { FState } from './engine/types';
import { localStore } from '../shell/localSaves';

export const fathomSaves = localStore<FState>('fathom-save', (s) => ({
  over: s.phase === 'over',
  title: s.phase === 'over' ? 'Finished' : `Tide ${s.tide} of 4`,
  players: s.players.map((p) => p.name).join(', '),
}));
