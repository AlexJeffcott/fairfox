// fairfox service worker — KILL SWITCH.
//
// Previous versions of this worker (v3 and earlier) precached the
// landing shell and treated hashed asset URLs as cache-first. A subset
// of users reported the SPA loading to a blank page with the renderer
// unresponsive; the worker was the only fairfox component running in a
// thread of its own and the only candidate that could keep the
// renderer busy without surfacing a console error to the page. Rather
// than guess at which cache entry was poisoned, this version unwinds
// the worker entirely: it claims every client, deletes every fairfox
// cache, unregisters itself, and reloads the open tabs so the next
// load goes through the network with no worker in the path.
//
// Once the freeze report is resolved we can reintroduce a worker with
// a fresh scope and stricter invariants. Until then, defaulting to
// "no service worker" is the safer position.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        // best-effort — proceed to unregister even if cache deletion fails
      }
      try {
        await self.registration.unregister();
      } catch {
        // best-effort
      }
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.navigate(client.url);
        }
      } catch {
        // best-effort
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  // Pass every request straight to the network — never serve from
  // cache while the kill switch is active.
  event.respondWith(fetch(event.request));
});
