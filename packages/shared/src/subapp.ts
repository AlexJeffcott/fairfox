// Minimal types the Bun.serve WebSocket handler threads through
// itself. The old `SubApp` / `WsSubApp` interfaces were for the
// legacy /todo and /struggle sub-apps, which were retired on
// 2026-04-22; only the signalling-role carrier survived.

export interface WsData {
  readonly role: 'signaling';
  /** Populated by the signalling relay on `join`. Used by the close
   * handler to emit `peer-left` to the remaining incumbents and to
   * evict the peer's entry only if the socket still owns it. */
  peerId?: string;
}
