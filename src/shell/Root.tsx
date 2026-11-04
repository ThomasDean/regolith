// The whole site: the hub at `/`, and each game under its own path, loaded only when opened.
import { lazy, Suspense, useCallback } from 'react';
import { useSession } from '../cloud';
import { usePwa } from '../pwa';
import { Home } from './Home';
import { navigate, useLocation } from './route';

const RegolithApp = lazy(() => import('../ui/App').then((m) => ({ default: m.App })));
const FathomApp = lazy(() => import('../fathom/ui/FathomApp').then((m) => ({ default: m.FathomApp })));

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function Root() {
  const { path } = useLocation();
  const session = useSession();
  // a tapped "your move" notification opens its game, wherever you are
  const openUrl = useCallback((href: string) => {
    try {
      const u = new URL(href, location.origin);
      if (u.origin !== location.origin) return;
      // links from before the hub (`/?room=ID`) are Regolith's
      navigate(u.pathname === '/' && u.searchParams.has('room') ? `/regolith${u.search}` : `${u.pathname}${u.search}`);
    } catch { /* not a link */ }
  }, []);
  usePwa(session?.user.id, openUrl);
  return (
    <Suspense fallback={<div className="loading-screen" role="status"><span>Loading…</span></div>}>
      {under(path, '/regolith') ? <RegolithApp /> : under(path, '/fathom') ? <FathomApp /> : <Home />}
    </Suspense>
  );
}
