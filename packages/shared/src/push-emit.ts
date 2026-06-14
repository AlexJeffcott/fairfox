// Sender-side wake emission.
//
// Sub-app effects that produce notification-worthy events
// (`chat.send`, agenda item creation, todo quick-capture) call
// `emitWake(senderDeviceId, payload)` after their mesh write.
// This module then:
//
//   1. Reads `mesh:devices` for every non-revoked device EXCEPT the
//      sender's own; any with a `pushSubscription` is a target.
//      Same-user different-device counts — a user with a phone and a
//      laptop wants the phone to buzz when they send from the laptop.
//   2. Skips devices currently in `peersPresent` (the mesh will
//      deliver the change in milliseconds; a redundant push would
//      buzz the phone for no reason).
//   3. POSTs to `/push/send` on the relay with the payload + the
//      target subscriptions; the relay VAPID-signs and forwards via
//      `web-push`.
//   4. Clears the `pushSubscription` field on any device whose vendor
//      returned 404/410 — the endpoint is dead and the device will
//      re-subscribe on its next boot.
//
// Best-effort throughout. Network errors, missing VAPID config on
// the relay, and unsupported environments all short-circuit
// silently; the local mesh write is always the source of truth.

import { clearPushSubscription, devicesState } from '#src/devices-state.ts';
import { peersPresent } from '#src/peers-presence.ts';

export interface WakePayload {
  /** Sub-app the event came from. Lets the SW pick an icon/route
   * variant in a later version; ignored by the v1 SW. */
  kind: 'chat' | 'agenda' | 'todo';
  /** Notification title — first line on the lock screen. */
  title: string;
  /** Notification body — clipped to 200 chars by callers. The Web
   * Push 4 KiB total budget is comfortable for short snippets and
   * tight for full message bodies; senders truncate. */
  body: string;
  /** Coalescing tag. Repeated pushes with the same tag replace each
   * other (with `renotify: true` in the SW, they re-buzz). Typical
   * shape: `chat:<chatId>`, `agenda:<itemId>`. */
  tag: string;
  /** Route to focus / open when the user taps the notification. */
  url: string;
}

interface PushSendResponse {
  skipped?: 'user-online';
  results?: Array<{ endpoint: string; status: number; ok: boolean }>;
}

/** Emit a wake to every offline device on the mesh that isn't the
 * sender's own. Same-user different-device is intended: laptop sends,
 * the user's phone gets the buzz. Returns silently on every error —
 * callers don't await the result. */
export async function emitWake(senderDeviceId: string, payload: WakePayload): Promise<void> {
  if (typeof fetch === 'undefined') {
    return;
  }
  await devicesState.loaded;
  const devices = Object.values(devicesState.value.devices ?? {});
  const live = peersPresent.value;
  // Candidate = every non-revoked, non-sender device that has a push
  // subscription and isn't currently live on the signalling channel.
  const candidates = devices.filter(
    (d) => d.peerId !== senderDeviceId && !d.revokedAt && d.pushSubscription && !live.has(d.peerId)
  );
  if (candidates.length === 0) {
    return;
  }
  const targets = candidates
    .map((d) => d.pushSubscription)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  // Map endpoint → peerId so the 404/410 cleanup pass can match
  // results back to device rows.
  const endpointToPeerId = new Map<string, string>();
  for (const d of candidates) {
    if (d.pushSubscription) {
      endpointToPeerId.set(d.pushSubscription.endpoint, d.peerId);
    }
  }
  let response: PushSendResponse;
  try {
    const res = await fetch('/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // recipientUserId is unused by the relay's online-skip when
        // the index is empty (polly's join frame omits userId today),
        // but the endpoint still validates the shape; pass the
        // sender's device id as a tag.
        recipientUserId: senderDeviceId,
        payload,
        targets,
      }),
    });
    if (!res.ok) {
      return;
    }
    response = (await res.json()) as PushSendResponse;
  } catch {
    return;
  }
  if (!response.results) {
    return;
  }
  // Cleanup pass — clear any subscription the vendor reported gone.
  // RFC 8030 §7.3: 404 means the subscription was never valid, 410
  // means it expired. Either way, the device needs to re-subscribe.
  for (const r of response.results) {
    if (r.ok || (r.status !== 404 && r.status !== 410)) {
      continue;
    }
    const peerId = endpointToPeerId.get(r.endpoint);
    if (peerId) {
      try {
        clearPushSubscription(peerId);
      } catch {
        // best-effort
      }
    }
  }
}
