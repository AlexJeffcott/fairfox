// Device capabilities — a self-declared list of what this device can
// do technically. Distinct from user permissions: capabilities say
// "this device has a camera" / "this device is installed as a PWA" /
// "this device is the LLM relay"; permissions say "this user is
// allowed to invite another user." UI uses capabilities to hide
// affordances that simply won't work here (no camera → no QR scan
// button) and capabilities are advisory, not enforced. Anything
// load-bearing for correctness falls back to a permission check.
//
// The probes are cheap synchronous reads off `navigator.*` and
// `typeof` checks — safe to call on every `touchSelfDeviceEntry`.
// Results are sorted so repeated writes produce stable `mesh:devices`
// diffs; a flap between orderings would churn the Automerge doc.

import type { Capability } from '#src/devices-state.ts';

/** Probe the running environment for every capability fairfox knows
 * about. Sorted alphabetically so the resulting array is stable
 * across calls with the same capability set. */
export function detectCapabilities(): Capability[] {
  const found = new Set<Capability>();
  if (typeof window === 'undefined') {
    // Server / Node — no browser capabilities. An explicit CLI probe
    // in `packages/cli` can call its own detector for CLI-specific
    // capabilities (e.g. `llm-peer` when the process is wired up to
    // call the LLM API).
    return [];
  }
  // webrtc: RTCPeerConnection indicates the WebRTC data-channel
  // transport works here; the mesh uses this for peer-to-peer sync.
  if (typeof RTCPeerConnection !== 'undefined') {
    found.add('webrtc');
  }
  // pwa-installed: the PWA is active when the tab is launched
  // standalone (iOS) or display-mode is standalone (everyone else).
  try {
    const navAny = navigator as Navigator & { standalone?: boolean };
    if (window.matchMedia?.('(display-mode: standalone)').matches || navAny.standalone === true) {
      found.add('pwa-installed');
    }
  } catch {
    // matchMedia unavailable; skip.
  }
  // push-notifications: service worker + Notification API both
  // present. Doesn't imply the user granted permission — the gate
  // for "can we ask?" vs "have we been granted?" is a separate UI
  // concern.
  if ('serviceWorker' in navigator && typeof Notification !== 'undefined') {
    found.add('push-notifications');
  }
  // camera: mediaDevices API present. Devices without a physical
  // camera (a desktop without a webcam) still advertise this;
  // probing further would require actually calling getUserMedia
  // which triggers a permission prompt.
  if (typeof navigator.mediaDevices !== 'undefined') {
    found.add('camera');
  }
  // keyboard: desktop-class devices. Heuristic — touch-only devices
  // have `ontouchstart` and typically no external keyboard.
  // Not perfect (tablets with keyboards exist) but the downstream
  // use is "should we show keyboard shortcuts hints?" where a false
  // negative on a tablet-with-keyboard is better than always showing
  // shortcuts on touch-only devices.
  if (!('ontouchstart' in window) || window.matchMedia?.('(hover: hover)').matches) {
    found.add('keyboard');
  }
  // background-sync: Chromium-only for now, but the capability is
  // advisory — sub-apps can ask "does any paired device have
  // background-sync?" and route queued writes to it.
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    found.add('background-sync');
  }
  return Array.from(found).sort();
}
