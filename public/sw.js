// Board games service worker: keeps the app usable offline (hotseat play needs no server) and
// handles Web Push for online games: shows "your move" notifications and sets the Home Screen
// badge to the number of games waiting on you. Plain JS, served as-is from the site root.
const CACHE = 'regolith-v1';
const SCOPE = self.registration.scope; // e.g. https://playboardgames.vercel.app/

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icons/icon-192.png'])).catch(() => {}),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------- offline

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase, fonts and anything else on another origin go straight to the network.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    // Network first so a new deploy shows up at once. The app's pages (the hub and every game's
    // path, with or without ?join= and the like) all share one offline shell, kept under the root.
    const isApp = url.pathname === '/' || /^\/(regolith|fathom)(\/|$)/.test(url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isApp && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SCOPE, copy)); }
          return res;
        })
        .catch(() => (isApp ? caches.match(SCOPE) : Promise.resolve(undefined)).then((hit) => hit || Response.error())),
    );
    return;
  }

  // Built files have content hashes in their names, so a cached copy never goes stale.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // Icons, manifest: serve the cached copy and refresh it in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      });
      return hit || fresh;
    }),
  );
});

// ---------------------------------------------------------------- push

function setBadge(n) {
  const nav = self.navigator;
  if (typeof n !== 'number' || !nav) return Promise.resolve();
  try {
    if (n > 0 && nav.setAppBadge) return nav.setAppBadge(n).catch(() => {});
    if (n <= 0 && nav.clearAppBadge) return nav.clearAppBadge().catch(() => {});
  } catch { /* badges unsupported */ }
  return Promise.resolve();
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  // iOS requires every push to show a notification, so always show one.
  const show = self.registration.showNotification(data.title || 'Regolith', {
    body: data.body || '',
    tag: data.tag || undefined,       // one notification per game: a newer one replaces the older
    renotify: !!data.tag,
    icon: SCOPE + 'icons/icon-192.png',
    data: { url: data.url || SCOPE },
  });
  event.waitUntil(Promise.all([show, setBadge(data.badge)]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || SCOPE, SCOPE).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(SCOPE));
      if (open) {
        // The app is already running: switch it to the game without reloading.
        return open.focus().then(() => open.postMessage({ type: 'open-url', url: target }));
      }
      return self.clients.openWindow(target);
    }),
  );
});
