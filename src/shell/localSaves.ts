// Games saved in this browser, any number per game. Each game is kept under its own key, with a
// small index beside it so the hub can list games without parsing every save.
//
// The index changing (a game started, finished or deleted) fires a window event the hub's
// "your games" list listens for.

export interface LocalMeta {
  id: string;
  /** ms since epoch */
  updated: number;
  over: boolean;
  /** e.g. "Generation 4" or "Tide 2" */
  title: string;
  players: string;
}

export const SAVES_EVENT = 'boardgames:saves';
const notify = () => { try { window.dispatchEvent(new Event(SAVES_EVENT)); } catch { /* no window */ } };

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } };

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);

export interface LocalStore<T> {
  list(): LocalMeta[];
  load(id: string): T | null;
  save(id: string, state: T): void;
  remove(id: string): void;
}

/**
 * `prefix` namespaces the keys (`<prefix>:index`, `<prefix>:<id>`); `meta` summarises a state
 * for the index. Finished games beyond `keepFinished` are dropped, oldest first, and when the
 * browser runs out of room the oldest finished (then oldest) games go first.
 */
export function localStore<T>(prefix: string, meta: (s: T) => Omit<LocalMeta, 'id' | 'updated'>, keepFinished = 5): LocalStore<T> {
  const INDEX = `${prefix}:index`;
  const item = (id: string) => `${prefix}:${id}`;
  const readIndex = (): LocalMeta[] => {
    try { const v = JSON.parse(get(INDEX) ?? '[]'); return Array.isArray(v) ? (v as LocalMeta[]) : []; } catch { return []; }
  };
  const writeIndex = (xs: LocalMeta[]) => { try { localStorage.setItem(INDEX, JSON.stringify(xs)); } catch { /* storage unavailable */ } };

  const prune = (xs: LocalMeta[], aggressive: boolean): LocalMeta[] => {
    const finished = xs.filter((x) => x.over).sort((a, b) => b.updated - a.updated);
    const drop = new Set(finished.slice(aggressive ? 0 : keepFinished).map((x) => x.id));
    if (aggressive && !drop.size && xs.length > 1) drop.add([...xs].sort((a, b) => a.updated - b.updated)[0].id);
    for (const id of drop) del(item(id));
    return xs.filter((x) => !drop.has(x.id));
  };

  return {
    list: () => readIndex().sort((a, b) => b.updated - a.updated),
    load(id) {
      try { const raw = get(item(id)); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
    },
    save(id, state) {
      const m: LocalMeta = { id, updated: Date.now(), ...meta(state) };
      let idx = readIndex();
      const before = idx.find((x) => x.id === id);
      idx = [m, ...idx.filter((x) => x.id !== id)];
      const raw = JSON.stringify(state);
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          localStorage.setItem(item(id), raw);
          break;
        } catch (e) {
          if (!isQuota(e)) return;
          const next = prune(idx.filter((x) => x.id !== id), true);
          if (next.length === idx.length - 1) return; // nothing left to drop
          idx = [m, ...next];
        }
      }
      if (m.over && !before?.over) idx = [m, ...prune(idx.slice(1), false)];
      writeIndex(idx);
      if (!before || before.over !== m.over || before.title !== m.title) notify();
    },
    remove(id) {
      del(item(id));
      writeIndex(readIndex().filter((x) => x.id !== id));
      notify();
    },
  };
}

export const newId = (): string => {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
};
