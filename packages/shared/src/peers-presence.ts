// Peer presence — a signal of peer ids currently connected to the
// signalling server, as seen by this device.
//
// Polly's mesh client exposes presence only as a callback surface
// (`onPeersPresent`, `onPeerJoined`, `onPeerLeft` on the signalling
// client), not as a reactive signal. This module wires those callbacks
// into a single `Set<string>` signal so the peer list UI can render
// online/offline state without polling.
//
// Best-effort by construction: the signalling server knows who is
// connected to *it*, not whether the WebRTC data channel between this
// device and a peer is actually passing bytes. A dead data channel
// with a live signalling socket will show green. That is a tolerable
// v1 — the user still sees "this peer is trying" — and a later
// WebRTC keepalive would sharpen it.

import { signal } from '@preact/signals';

export const peersPresent = signal<ReadonlySet<string>>(new Set());

export function markPeersPresent(peerIds: readonly string[]): void {
  peersPresent.value = new Set(peerIds);
}

export function markPeerJoined(peerId: string): void {
  if (peersPresent.value.has(peerId)) {
    return;
  }
  const next = new Set(peersPresent.value);
  next.add(peerId);
  peersPresent.value = next;
}

export function markPeerLeft(peerId: string): void {
  if (!peersPresent.value.has(peerId)) {
    return;
  }
  const next = new Set(peersPresent.value);
  next.delete(peerId);
  peersPresent.value = next;
}

export function resetPeersPresent(): void {
  peersPresent.value = new Set();
}
