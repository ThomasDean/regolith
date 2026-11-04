// Regolith hotseat games saved in this browser. Any number can be in progress at once; each is
// keyed by its cloud-save id, so a game keeps the same identity on this device and in the cloud.
import type { GameState } from '../engine/types';
import { localStore } from '../shell/localSaves';

export const regolithSaves = localStore<GameState>('regolith-save', (s) => ({
  over: s.phase === 'over',
  title: s.phase === 'over' ? 'Finished' : `Generation ${s.generation}`,
  players: s.players.map((p) => p.name).join(', '),
}));

const LEGACY = 'regolith-save-v1';

/** Moves the single save from before multi-game saves into the new store, once. */
export function migrateLegacySave() {
  try {
    const raw = localStorage.getItem(LEGACY);
    if (!raw) return;
    const s = JSON.parse(raw) as GameState;
    const id = localStorage.getItem('regolith-cloud-id') ?? crypto.randomUUID();
    if (s?.players && !regolithSaves.load(id)) regolithSaves.save(id, s);
    localStorage.removeItem(LEGACY);
  } catch { /* leave it */ }
}
