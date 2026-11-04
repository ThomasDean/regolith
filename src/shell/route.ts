// Path-based routing for the game hub: `/` is the game picker, each game lives under its own
// path (`/regolith`, `/fathom`). One origin keeps one sign-in, one PWA install and one set of
// push subscriptions across every game.
//
// The single-file build is opened from disk (file:// URLs), where paths mean nothing, so there
// the route lives in memory only.
import { useSyncExternalStore } from 'react';

const memoryMode = import.meta.env.MODE === 'single' || (typeof location !== 'undefined' && location.protocol === 'file:');
let memory = '/';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

const real = () => `${location.pathname}${location.search}${location.hash}`;
export const currentLocation = (): string => (memoryMode ? memory : real());

/** Goes to another page of the app without a reload. */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === currentLocation()) return;
  if (memoryMode) memory = to;
  else if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  emit();
  if (!opts.replace && typeof window !== 'undefined') window.scrollTo(0, 0);
}

function subscribe(f: () => void) {
  listeners.add(f);
  if (listeners.size === 1 && !memoryMode) window.addEventListener('popstate', emit);
  return () => {
    listeners.delete(f);
    if (!listeners.size && !memoryMode) window.removeEventListener('popstate', emit);
  };
}

export interface Loc { path: string; params: URLSearchParams; hash: string }

export function parseLocation(href: string): Loc {
  const u = new URL(href, 'https://x.invalid');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return { path, params: u.searchParams, hash: u.hash };
}

/** The current page; re-renders on navigation and on the browser's back/forward buttons. */
export function useLocation(): Loc {
  const href = useSyncExternalStore(subscribe, currentLocation, () => '/');
  return parseLocation(href);
}

/**
 * Links from before the hub (invite links `/?join=CODE`, notification links `/?room=ID`, and
 * `/#gallery`) belong to Regolith: send them there.
 */
export function redirectLegacy() {
  if (memoryMode) return;
  const { pathname, search, hash } = location;
  if (pathname !== '/' && pathname !== '/index.html') return;
  const q = new URLSearchParams(search);
  if (q.has('join') || q.has('room') || hash === '#gallery' || hash === '#online-sim') {
    history.replaceState(null, '', `/regolith${search}${hash}`);
  }
}
