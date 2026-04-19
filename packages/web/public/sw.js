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

const CACHE_VERSION = 'v1';
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
  event.respondWith(cacheFirst(request));
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
