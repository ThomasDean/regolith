// Your custom cards and the groups you sort them into. Kept in this browser, and in your
// account when you're signed in (so they follow you to other devices). Cards are checked by
// the engine (custom.ts) before they're kept, and again by the server when a game starts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { finishCustom, type CustomCard } from '../engine/custom';
import { cloudEnabled, sb, useSession } from '../cloud';

export interface CardGroup { id: string; name: string; cards: string[] }
export interface Library { cards: CustomCard[]; groups: CardGroup[] }

const KEY = 'regolith-custom-library';
const PICK_KEY = 'regolith-custom-groups';
const EVENT = 'regolith:custom-library';

const empty = (): Library => ({ cards: [], groups: [] });

/** Keeps only valid cards and groups that point at them. */
function clean(raw: unknown): Library {
  const r = raw as Partial<Library> | null;
  const cards: CustomCard[] = [];
  for (const c of Array.isArray(r?.cards) ? r!.cards : []) {
    try { const ok = finishCustom(c); if (!cards.some((x) => x.id === ok.id)) cards.push(ok); } catch { /* drop it */ }
  }
  const ids = new Set(cards.map((c) => c.id));
  const groups = (Array.isArray(r?.groups) ? r!.groups : [])
    .filter((g): g is CardGroup => !!g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.cards))
    .map((g) => ({ id: g.id, name: g.name.slice(0, 40), cards: g.cards.filter((id) => ids.has(id)) }));
  return { cards, groups };
}

function loadLocal(): Library {
  try { return clean(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return empty(); }
}
function saveLocal(lib: Library) {
  try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch { /* storage full or unavailable */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

/** Both copies together: every card from either, groups by id (this device's version wins). */
function merge(a: Library, b: Library): Library {
  const cards = [...a.cards, ...b.cards.filter((c) => !a.cards.some((x) => x.id === c.id))];
  const groups = [...a.groups, ...b.groups.filter((g) => !a.groups.some((x) => x.id === g.id))];
  return clean({ cards, groups });
}

async function loadCloud(): Promise<Library> {
  const { data, error } = await sb().schema('regolith').rpc('get_card_library');
  if (error) throw new Error(error.message);
  return clean(data);
}
async function saveCloud(lib: Library) {
  const { error } = await sb().schema('regolith').rpc('put_card_library', { p_library: lib });
  if (error) throw new Error(error.message);
}

/** The library, kept in sync with storage, other tabs and (when signed in) your account. */
export function useLibrary(): { lib: Library; set: (next: Library) => void; cloud: 'off' | 'syncing' | 'saved' | 'error' } {
  const [lib, setLib] = useState<Library>(loadLocal);
  const session = useSession();
  const [cloud, setCloud] = useState<'off' | 'syncing' | 'saved' | 'error'>('off');
  const signedIn = cloudEnabled && !!session;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const on = () => setLib(loadLocal());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  // signing in: bring in the cards saved to the account and send this device's up
  useEffect(() => {
    if (!signedIn) { setCloud('off'); return; }
    let live = true;
    setCloud('syncing');
    loadCloud().then((remote) => {
      if (!live) return;
      const both = merge(loadLocal(), remote);
      saveLocal(both);
      setLib(both);
      return saveCloud(both).then(() => live && setCloud('saved'));
    }).catch(() => live && setCloud('error'));
    return () => { live = false; };
  }, [signedIn]);
  const set = useCallback((next: Library) => {
    const c = clean(next);
    saveLocal(c);
    setLib(c);
    if (!signedIn) return;
    if (timer.current) clearTimeout(timer.current);
    setCloud('syncing');
    timer.current = setTimeout(() => { saveCloud(c).then(() => setCloud('saved'), () => setCloud('error')); }, 800);
  }, [signedIn]);
  return { lib, set, cloud };
}

/** Group ids picked for the next game (remembered on this device). */
export function loadPickedGroups(): string[] {
  try { const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export function savePickedGroups(ids: string[]) {
  try { localStorage.setItem(PICK_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

/** The cards in the chosen groups, each once. */
export function cardsInGroups(lib: Library, groupIds: string[]): CustomCard[] {
  const ids = new Set(lib.groups.filter((g) => groupIds.includes(g.id)).flatMap((g) => g.cards));
  return lib.cards.filter((c) => ids.has(c.id));
}

/** Saves an edited card: replaces the old version everywhere it was grouped. */
export function putCard(lib: Library, card: CustomCard, replacing?: string): Library {
  const cards = lib.cards.filter((c) => c.id !== replacing && c.id !== card.id);
  const at = replacing ? lib.cards.findIndex((c) => c.id === replacing) : -1;
  cards.splice(at >= 0 ? at : cards.length, 0, card);
  const groups = lib.groups.map((g) => ({ ...g, cards: [...new Set(g.cards.map((id) => (id === replacing ? card.id : id)))] }));
  return { cards, groups };
}

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `g${Date.now()}${Math.random().toString(36).slice(2)}`);
