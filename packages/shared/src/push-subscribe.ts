// Client-side Web Push subscription lifecycle.
//
// One module covers the four moments a fairfox device interacts with
// the browser's push service:
//
//   1. Probe — has the user already granted permission and does this
//      device already have an active subscription?
//   2. Request — ask the browser for permission. Must be inside a
//      user gesture; the caller (a Settings-tab button, typically)
//      drives this.
//   3. Subscribe — bind the granted permission to this server's VAPID
//      identity, and write the resulting subscription onto this
//      device's row in `mesh:devices` so other peers can wake it.
//   4. Cleanup — if the subscription stops working (the next push
//      returns 404/410 from the vendor), clear the field so other
//      peers stop trying to push to a dead endpoint.
//
// All four are safe to call on any device — non-PWA Android, desktop
// Safari, iOS without the PWA installed — they return null on
// unsupported environments rather than throwing. The Settings UI
// hides the affordance based on `detectCapabilities()`'s
// `push-notifications` flag.

import {
  clearPushSubscription,
  devicesState,
  type PushSubscriptionRecord,
  upsertDeviceEntry,
} from '#src/devices-state.ts';

/** True when the browser exposes the APIs Web Push needs AND the
 * page is in a secure context. Browsers already gate `serviceWorker`,
 * `PushManager`, and `Notification.requestPermission` on
 * `window.isSecureContext`; checking explicitly here lets the UI
 * surface a clearer message ("not on HTTPS — open the prod URL or
 * use the local-https dev script") instead of every call silently
 * resolving to a denial. Does NOT imply the user granted permission. */
export function pushSupported(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return false;
  }
  return (
    'serviceWorker' in navigator &&
    typeof Notification !== 'undefined' &&
    typeof PushManager !== 'undefined'
  );
}

/** Current notification permission, or `'unsupported'` on browsers
 * that don't expose the API. Cheap synchronous read; safe to call
 * inside a Preact effect. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

/** Prompt the user for notification permission. Must be invoked from
 * a user gesture (a button click). Safari + iOS PWA require this;
 * calling from a setTimeout or a Preact mount effect silently fails
 * on those platforms. */
export function requestPushPermission(): Promise<NotificationPermission> {
  if (!pushSupported()) {
    return Promise.resolve('denied');
  }
  return Notification.requestPermission();
}

/** Subscribe this device with the browser's push service and write
 * the result onto its row in `mesh:devices`. Idempotent — calling
 * twice returns the same subscription bytes and rewrites the same
 * field. Returns the record on success, null when push isn't
 * supported, permission isn't granted, or the relay has no VAPID
 * key configured. */
export async function ensurePushSubscription(
  selfPeerId: string
): Promise<PushSubscriptionRecord | null> {
  if (!pushSupported()) {
    return null;
  }
  if (Notification.permission !== 'granted') {
    return null;
  }
  // The SW must be installed before the browser will hand out a
  // subscription; this resolves immediately when one is already
  // active (the normal case after `installServiceWorker()` at boot).
  const registration = await navigator.serviceWorker.ready;
  // Pull the VAPID public key from the relay. The response is
  // cached for an hour client-side; refetching every boot is
  // tolerated because the relay's `Cache-Control: public, max-age=3600`
  // means HTTP cache absorbs the cost.
  let publicKey: string;
  try {
    const res = await fetch('/push/vapid-public-key');
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { publicKey?: unknown };
    if (typeof data.publicKey !== 'string') {
      return null;
    }
    publicKey = data.publicKey;
  } catch {
    return null;
  }
  // `applicationServerKey` is the VAPID public key as a Uint8Array.
  // Subscription becomes bound to this server's VAPID identity — if
  // the key rotates, the subscription stops working and the device
  // has to re-subscribe (see `clearPushSubscription`).
  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });
  } catch (err) {
    console.warn('[push] pushManager.subscribe failed:', err);
    return null;
  }
  const record = subscriptionToRecord(subscription);
  if (!record) {
    return null;
  }
  await devicesState.loaded;
  upsertDeviceEntry(selfPeerId, { pushSubscription: record });
  return record;
}

/** Drop this device's subscription — both at the browser layer and
 * in `mesh:devices`. Used by the Settings UI's "disable notifications"
 * button. */
export async function unsubscribePush(selfPeerId: string): Promise<void> {
  if (pushSupported()) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }
    } catch {
      // best-effort — the mesh row clears either way
    }
  }
  await devicesState.loaded;
  clearPushSubscription(selfPeerId);
}

function subscriptionToRecord(sub: PushSubscription): PushSubscriptionRecord | null {
  const p256dh = sub.getKey('p256dh');
  const auth = sub.getKey('auth');
  if (!p256dh || !auth) {
    return null;
  }
  return {
    endpoint: sub.endpoint,
    p256dh: uint8ArrayToBase64Url(new Uint8Array(p256dh)),
    auth: uint8ArrayToBase64Url(new Uint8Array(auth)),
    updatedAt: new Date().toISOString(),
  };
}

function base64UrlToUint8Array(input: string): Uint8Array<ArrayBuffer> {
  // Pad to a multiple of 4 and map URL-safe alphabet to standard.
  const padding = '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Allocate the backing ArrayBuffer explicitly so the resulting view
  // is Uint8Array<ArrayBuffer>, not Uint8Array<ArrayBufferLike>; the
  // DOM `applicationServerKey` slot only accepts the former.
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
