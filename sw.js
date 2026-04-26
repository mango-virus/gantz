// Gantz: Eternal Hunt — network-first service worker.
//
// Why this exists:
// GitHub Pages serves static assets with a default 10-minute browser cache
// (Cache-Control: max-age=600). After a deploy, peers can keep loading the
// stale JS bundle for ten minutes — which means somebody is running the old
// procedural mission map / collision zones while everyone else is in the new
// hand-authored Kabukichō map. P2P state diverges and the game looks broken.
//
// Strategy: network-first for every same-origin GET. We always try the
// network with `cache: 'reload'` so the HTTP cache is bypassed; if that
// fails (offline) we fall back to the most recent cached copy. On every
// successful network response we refresh the cache so the offline fallback
// is never older than the last time the user was online.
//
// We also self-update aggressively: skipWaiting() + clients.claim() means
// the new SW takes control on the next navigation rather than waiting for
// every tab to close.

const CACHE_NAME = 'gantz-runtime-v1';

self.addEventListener('install', (event) => {
  // Activate this SW immediately on install — don't wait for old tabs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Nuke any cache that isn't the current version.
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    );
    // Take control of any already-open pages.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Trystero / Nostr / fonts hit other origins
  // and we have no business intercepting those.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // `cache: 'reload'` bypasses the HTTP cache — this is the whole point.
      const fresh = await fetch(req, { cache: 'reload' });
      // Only stash successful, basic (same-origin) responses.
      if (fresh && fresh.ok && fresh.type === 'basic') {
        cache.put(req, fresh.clone()).catch(() => { /* ignore quota */ });
      }
      return fresh;
    } catch (err) {
      // Offline — fall back to whatever we last cached.
      const cached = await cache.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
