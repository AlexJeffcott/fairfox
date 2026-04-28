// Connection-recovery effects — lifecycle event handlers that nudge
// polly's signalling client when the OS, browser, or network state
// changes. Browser-only.
//
// Why this module exists:
//
// Polly's MeshSignalingClient already auto-reconnects after a normal
// drop, but the auto-reconnect is gated on `wasOpen === true` at
// close time (mesh.js:1255). On iOS Safari the most common failure
// is "tab suspended → WebSocket killed before any open event ever
// fired during the most recent connect attempt". `wasOpen` is false,
// `scheduleReconnect` doesn't fire, and the phone goes silent until
// somebody manually nudges it.
//
// Plus there is a "split-brain" failure mode: the WebSocket appears
// alive at signalling but every WebRTC data channel is dead, no docs
// merge for minutes. Polly does not detect this; the user sees
// "relay live" while writes pile up locally.
//
// The recovery effects:
//
//   - visibilitychange/online/pageshow/focus → if disconnected,
//     `requestReconnect` (close-then-connect cycle on the signalling
//     socket; polly's WebRTC adapter will re-handshake from
//     peer-joined notifications)
//   - pagehide → optimistic mark down so the badge does not flash
//     "connected" between suspension and the next wake event
//   - watchdog (every 30s) → if signalling claims connected but no
//     mesh activity for 90s, force a reconnect
//   - doc-metrics subscription → bump lastDocChangeAt whenever any
//     Automerge sync message lands, so the watchdog has a real
//     liveness signal

import { effect } from '@preact/signals';
import {
  lastDocChangeAt,
  markSignalingDown,
  type ReconnectReason,
  requestReconnect,
  signalingConnected,
} from '#src/mesh-connection-state.ts';

// Lazy-load `mesh` from ensure-mesh to avoid a top-level-await
// cycle (see comment in mesh-connection-state.ts). Loaded once at
// install time, used to subscribe to repo events.
async function loadMesh(): Promise<Awaited<typeof import('#src/ensure-mesh.ts')>['mesh']> {
  const m = await import('#src/ensure-mesh.ts');
  return m.mesh;
}

const WATCHDOG_TICK_MS = 30_000;
const STALE_THRESHOLD_MS = 90_000;

let installed = false;

/** Install the browser-side connection-recovery effects. Idempotent —
 * subsequent calls return early. Safe to call from non-browser
 * contexts; it no-ops there.
 *
 * Called from `boot.tsx` after `installMeshGateEffects()`. Mesh is
 * loaded lazily so we don't deadlock the top-level await graph. */
export function installConnectionRecovery(): void {
  if (installed) {
    return;
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  installed = true;

  // Repo doc-metrics: any incoming sync message proves the channel
  // is alive end-to-end. Bumping on sent-too is unnecessary — what
  // we care about is "are remote ops arriving". Subscribe lazily;
  // events that fire before the subscription completes simply do
  // not bump lastDocChangeAt — the next one will.
  void loadMesh().then((mesh) => {
    if (!mesh) {
      return;
    }
    mesh.repo.on('doc-metrics', (m) => {
      if (m.type === 'receive-sync-message') {
        lastDocChangeAt.value = Date.now();
      }
    });
  });

  function nudgeIfNeeded(reason: ReconnectReason): void {
    // Only fire on reasons that come bound with "user is here now,
    // try harder". The watchdog has its own gate below.
    if (signalingConnected.value && reason !== 'user') {
      // Connected — leave it alone. The watchdog will catch a
      // wedged-but-connected channel separately.
      return;
    }
    void requestReconnect(reason);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      nudgeIfNeeded('visibility');
    }
  });
  window.addEventListener('online', () => {
    nudgeIfNeeded('online');
  });
  window.addEventListener('pageshow', () => {
    nudgeIfNeeded('pageshow');
  });
  window.addEventListener('focus', () => {
    nudgeIfNeeded('focus');
  });
  window.addEventListener('pagehide', () => {
    // Reflect the suspension immediately so the badge stops
    // claiming "connected" while the tab is paused. Polly's own
    // close detection will catch up on next wake.
    markSignalingDown();
  });

  // Watchdog: connected but silent for too long → force reconnect.
  // This is what catches the split-brain "WebSocket alive,
  // every WebRTC data channel dead" case the user already hit.
  // We wrap setInterval in an effect-driven guard so the watchdog
  // re-evaluates whenever its inputs change (the actual setInterval
  // tick triggers the check at fixed cadence).
  setInterval(() => {
    if (!signalingConnected.value) {
      // Disconnected — the lifecycle handlers above will recover it
      // when the user comes back. No watchdog action needed.
      return;
    }
    const last = lastDocChangeAt.value;
    if (last === null) {
      // Connection is up but we have never received any sync ops.
      // Could be a cold start with no peers yet, OR a wedged
      // channel. Either way force-reconnecting once is cheap and
      // shakes loose the wedged case. Bound this to the post-
      // connect interval — we only fire if we have been connected
      // for longer than the stale threshold without any traffic.
      // Using `lastDocChangeAt` would loop forever if no peers
      // ever arrive; so gate on `mesh:devices` having more than
      // just our row before declaring stale. For the bare-minimum
      // cold-start case, treat null as "do nothing yet".
      return;
    }
    if (Date.now() - last < STALE_THRESHOLD_MS) {
      return;
    }
    // Connected, had previous activity, none in the last
    // STALE_THRESHOLD_MS — channel has gone silent. Force a
    // close-then-connect to shake loose any stuck WebRTC data
    // channel; polly will re-establish peer connections from the
    // resulting peers-present frame.
    void requestReconnect('watchdog');
  }, WATCHDOG_TICK_MS);

  // Touch the signal once at install time so an initial subscriber
  // sees a primed value rather than `null`.
  void effect(() => {
    void signalingConnected.value;
  });
}
