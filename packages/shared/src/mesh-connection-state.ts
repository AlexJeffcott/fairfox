// Reactive view of the mesh's transport-layer health, plus a single
// `requestReconnect` choke point.
//
// Polly's MeshSignalingClient owns the WebSocket and an internal
// auto-reconnect loop. The loop is gated on `wasOpen === true` at
// close time (mesh.js:1255) — if iOS Safari kills the socket
// before "open" ever fires (e.g. tab suspended mid-handshake), polly
// will not retry. Fairfox needs to nudge it from outside.
//
// This module exposes the signals the rest of the SPA reads (the
// chat widget badge, the recovery effects, future diagnostics) and
// the one function the recovery effects call. Keeping the
// transport state and the reconnect path in one module means there
// is exactly one place that knows how to drive the socket — every
// caller goes through `requestReconnect`, every read goes through
// the signals.
//
// Lives separately from `mesh.ts` so consumers (sub-app code,
// UI components) can subscribe without pulling polly's mesh client
// into their dependency graph.
//
// Browser and Node share these signals; the recovery module that
// drives the lifecycle event listeners (visibilitychange, online,
// pageshow, focus) is browser-only and lives in
// `connection-recovery.ts`.

import { signal } from '@preact/signals';

// Deliberately do NOT import `mesh` from ensure-mesh.ts at the top
// level. ensure-mesh's `await setup()` calls createMeshConnection,
// which dynamically imports this module to wire signal updates.
// A top-level `import { mesh }` here would create a top-level-await
// cycle that deadlocks the boot — ensure-mesh waits for setup,
// setup waits for this import to complete, this import waits for
// ensure-mesh's `mesh` export to be ready. Resolve `mesh` lazily
// inside `requestReconnect` after boot has settled.

/** True iff polly's signalling WebSocket is open AND the join frame
 * has been sent (joined === true). Updated by the 2 s poll in
 * `createMeshConnection` (mesh.ts) reading `signaling.isConnected`. */
export const signalingConnected = signal<boolean>(false);

/** ISO timestamp of the last signalling-layer error reported by polly,
 * or null if none. Set on the polly onError callback. The recovery
 * watchdog reads this when surfacing "auto-reconnecting…" to the
 * user; the chat widget badge can render it as a tooltip. */
export const lastSignalingErrorAt = signal<string | null>(null);

/** Most recent error message from polly's signalling layer. Truncated
 * by callers; we don't trim here. null if no error has occurred. */
export const lastSignalingErrorMessage = signal<string | null>(null);

/** Wall-clock millis of the most recent Automerge doc change applied
 * by this device's repo. The recovery watchdog uses this to detect
 * the split-brain case where the WebSocket is alive at signalling
 * but every WebRTC data channel is silent — under that condition
 * `signalingConnected` says we're up but no doc activity ever
 * arrives. Updated by the recovery module's repo subscription. */
export const lastDocChangeAt = signal<number | null>(null);

/** Reasons a reconnect can be requested. Throttle policy is applied
 * per-reason (see THROTTLE_MS_BY_REASON below) so an explicit user
 * click is never swallowed by the ambient-event throttle. */
export type ReconnectReason = 'visibility' | 'online' | 'pageshow' | 'focus' | 'watchdog' | 'user';

const THROTTLE_MS_BY_REASON: Record<ReconnectReason, number> = {
  visibility: 3_000,
  online: 3_000,
  pageshow: 3_000,
  focus: 3_000,
  // Watchdog and user actions bypass the throttle. The watchdog only
  // fires when the existing connection is provably stale and waiting
  // longer would mean more lost user time. User clicks are explicit
  // intent — eating the click feels broken.
  watchdog: 0,
  user: 0,
};

let lastAttemptByReason: Partial<Record<ReconnectReason, number>> = {};
let inFlight: Promise<void> | null = null;

/** Force the signalling client to close-then-reopen. Bare
 * `signaling.connect()` against an already-open polly socket is a
 * no-op against the underlying join state — `close()` first resets
 * `joined = false`, drops `stopping = true → false`, and a fresh
 * WebSocket constructor runs. That cycle is what makes
 * `requestReconnect` actually nudge a wedged channel.
 *
 * Per-reason throttle prevents rapid-fire visibility flapping from
 * hammering the server. `user` and `watchdog` reasons bypass it
 * (see THROTTLE_MS_BY_REASON).
 *
 * Concurrent calls coalesce onto a single in-flight promise — if a
 * reconnect is already running, the second caller waits for the
 * first to settle rather than queuing another close/connect. */
export async function requestReconnect(reason: ReconnectReason): Promise<void> {
  // Lazy-load to avoid the top-level-await cycle described above.
  // By the time any caller fires, ensure-mesh's setup() has resolved
  // and `mesh` is the live MeshConnection (or undefined in non-
  // browser contexts).
  const { mesh } = await import('#src/ensure-mesh.ts');
  if (!mesh) {
    return;
  }
  const now = Date.now();
  const throttle = THROTTLE_MS_BY_REASON[reason];
  if (throttle > 0) {
    const last = lastAttemptByReason[reason] ?? 0;
    if (now - last < throttle) {
      return Promise.resolve();
    }
  }
  lastAttemptByReason = { ...lastAttemptByReason, [reason]: now };
  if (inFlight) {
    return inFlight;
  }
  const client = mesh.signaling;
  inFlight = (async (): Promise<void> => {
    try {
      // close() flips polly's stopping flag; connect() resets it.
      // Order matters — calling connect on an open socket is the
      // wedged-no-op path we're trying to escape from.
      client.close();
      await client.connect();
    } catch (err) {
      // Connect failure is recorded via polly's onError callback
      // (which sets lastSignalingErrorAt). Swallow here so the
      // promise resolves; callers that want to know the result can
      // subscribe to `signalingConnected`.
      const msg = err instanceof Error ? err.message : String(err);
      lastSignalingErrorAt.value = new Date().toISOString();
      lastSignalingErrorMessage.value = msg;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Mark the WebSocket as definitely closed without touching polly.
 * Recovery uses this on `pagehide` so the UI doesn't flash
 * "connected" between suspension and the next wake event. Polly's
 * own onClose will catch up and confirm. */
export function markSignalingDown(): void {
  signalingConnected.value = false;
}
