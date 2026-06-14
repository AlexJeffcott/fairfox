// Service worker registration helper for fairfox.
//
// The worker at `/sw.js` is currently scoped to notifications only —
// it does not precache assets or intercept fetches (see the comment
// at the top of that file for the freeze-incident background). We
// still want it active because Web Push delivery requires a
// registered worker on the recipient device.
//
// Registration is best-effort: a browser that refuses (private mode
// on some platforms, or a hostile extension) leaves push disabled
// for that session, which is the same as not granting permission.
// No part of the SPA depends on the worker being installed.

const SW_PATH = '/sw.js';
const SW_SCOPE = '/';

/** Register the fairfox service worker. Idempotent — the browser
 * returns the existing registration if one is already installed and
 * silently no-ops if the file hasn't changed. */
export async function installServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
    // Kick the browser to check for an updated worker on every boot.
    // The file ships with `Cache-Control: no-store` so this is a
    // network hit, not an HTTP-cache hit; if the bytes match the
    // installed worker, the browser short-circuits.
    void registration.update();
    return registration;
  } catch (err) {
    console.warn('[fairfox] service worker registration failed:', err);
    return null;
  }
}
