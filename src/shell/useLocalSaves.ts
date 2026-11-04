import { useEffect, useState } from 'react';
import { SAVES_EVENT, type LocalMeta, type LocalStore } from './localSaves';

/** The games in a local store, kept current as games start, finish or are deleted. */
export function useLocalSaves(store: LocalStore<unknown>): LocalMeta[] {
  const [list, setList] = useState(() => store.list());
  useEffect(() => {
    const f = () => setList(store.list());
    window.addEventListener(SAVES_EVENT, f);
    return () => window.removeEventListener(SAVES_EVENT, f);
  }, [store]);
  return list;
}
