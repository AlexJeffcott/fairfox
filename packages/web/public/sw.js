// fairfox service worker.
//
// Scope: notifications only. The v3-and-earlier worker precached the
// SPA shell and treated hashed asset URLs as cache-first; a subset of
// users reported the SPA loading to a blank page with the renderer
// unresponsive, and the worker was the only fairfox component running
// in a thread of its own. Rather than re-introduce that risk while
// the trauma is fresh, this worker keeps fetch handling pass-through
// (no cache reads, no precache writes) and exists for one reason:
// receiving Web Push events when the SPA is closed.
//
// Reintroduce caching only with a fresh scope, a kill-switch in the
// SPA that can disable it without redeploying, and a verifiable
// offline shell test in scripts/. Until then, "no caching" is the
// safer position.
//
// Push payload shape (RFC 8291 plaintext after decryption):
//   {
//     kind: 'chat' | 'agenda' | 'todo',
//     title: string,
//     body: string,
//     tag: string,
//     url: string,
//   }
// The sender (any mesh peer) encrypts this to the recipient
// subscription's p256dh+auth; the relay only signs the VAPID JWT and
// forwards ciphertext, never sees plaintext.

const SW_VERSION = 'fairfox-sw-v4-notifications';

self.addEventListener('install', (event) => {
  // Activate the new worker immediately on next load — no
  // "waiting-for-old-tabs-to-close" stalls.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Sweep any caches the kill-switch worker (or its v3 ancestor)
      // may have left behind. Future caching versions of this worker
      // must add their own cache names to the keep-list before this
      // ships, or every installed PWA will lose its offline shell on
      // upgrade.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        // best-effort
      }
      await self.clients.claim();
      console.log(`[sw] ${SW_VERSION} active`);
    })()
  );
});

self.addEventListener('fetch', (event) => {
  // Pass-through. The renderer and the network see the same bytes
  // they would without a worker in the path. When we reintroduce
  // caching this is where the strategy goes — for now, do nothing.
  event.respondWith(fetch(event.request));
});

// --- Push handler --------------------------------------------------

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let payload = null;
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      // Vendor delivered a non-JSON body — show a generic banner so
      // iOS doesn't penalise the origin for swallowing the push.
    }
  }
  const title = (payload && typeof payload.title === 'string' && payload.title) || 'fairfox';
  const body = (payload && typeof payload.body === 'string' && payload.body) || '';
  const tag = (payload && typeof payload.tag === 'string' && payload.tag) || 'fairfox';
  const url = (payload && typeof payload.url === 'string' && payload.url) || '/';
  await self.registration.showNotification(title, {
    body,
    tag,
    // `renotify` lets repeated pushes with the same tag re-fire the
    // OS notification banner instead of silently updating the
    // existing one. Useful for chat — three messages in a row should
    // feel like three pings, not one.
    renotify: true,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url },
  });
}

// --- Notification click --------------------------------------------

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpen(event));
});

async function focusOrOpen(event) {
  const target =
    (event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/') || '/';
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Prefer an existing fairfox tab — focus it and navigate if needed.
  for (const client of clients) {
    if (client.url.includes(self.location.origin)) {
      try {
        await client.focus();
        if (!client.url.endsWith(target)) {
          await client.navigate(target);
        }
        return;
      } catch {
        // Some browsers reject .navigate() across origins; fall
        // through to openWindow.
      }
    }
  }
  // No live tab — open a fresh one. On iOS this brings the installed
  // PWA to the foreground.
  await self.clients.openWindow(target);
}
