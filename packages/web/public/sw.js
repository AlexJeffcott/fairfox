// fairfox service worker.
//
// The worker exists primarily to unlock the "install as an app" prompt
// on Chromium and to keep the mesh sub-apps runnable on a flaky or
// absent network. It is deliberately small: a single precache for the
// landing shell and the manifest, then two fetch strategies.
//
// For navigation requests (HTML documents) the worker prefers the
// network so a fresh deploy reaches the user on the next page load;
// on failure it falls back to the cached landing, giving the installed
// app *some* opening screen when offline. For every other same-origin
// GET — the hashed JS/CSS bundles served by `bundle-subapp`, the
// manifest, the icons, the CLI bundle — the worker reads the cache
// first and writes successful network responses back into it. Hashed
// URLs change on each deploy, so stale entries fall out of use
// naturally rather than needing manual busting.
//
// No cross-origin requests are cached. Signalling WebSocket upgrades
// and POSTs to the legacy todo/struggle APIs pass through untouched.

// v3: the mesh-app cutover — every mesh route now returns the same
// unified SPA shell, so sub-app JS under /todo-v2, /agenda, etc. no
// longer exists. Bumping the version evicts any stale per-sub-app
// entries from previous installs on the first activate after the
// deploy lands.
const CACHE_VERSION = 'v3';
const CACHE_NAME = `fairfox-${CACHE_VERSION}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Fingerprinted-asset filter. `bundle-subapp` emits bundle artefacts
// under `/<subapp>/[name]-[hash].[ext]` — the 8-plus-char hash fragment
// is the content address, so anything matching the pattern is safe to
// cache aggressively and irrelevant to cache too little. Everything
// else — including `/build-hash`, `/api/*`, `/cli/*`, `/extension/*`,
// and the navigation responses that carry the build-hash meta — goes
// straight to the network. A stale /build-hash response in the SW
// cache was what kept the BuildFreshnessBanner up permanently: the
// meta tag refreshed on reload but the polled endpoint returned an
// older hash from cache, and the two never agreed.
const FINGERPRINT_PATTERN = /-[0-9a-z]{8,}\.(?:js|css|map|woff2?|png|jpg|jpeg|svg|webp|gif|ico)$/i;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (
    FINGERPRINT_PATTERN.test(url.pathname) ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/icon-maskable.svg'
  ) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else (build-hash, APIs, CLI download, extension zip, …)
  // is left alone — the default browser fetch handles it with the
  // server's own Cache-Control.
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    const shell = await cache.match('/');
    if (shell) {
      return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}
