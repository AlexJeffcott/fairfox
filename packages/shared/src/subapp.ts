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
  /** Populated by the signalling relay on `join` when the client
   * sends its `userId` alongside `peerId`. Lets the relay build a
   * `userId → set<peerId>` index used by the push pipeline to skip
   * notifications for users who already have a live socket. Older
   * clients that don't send a userId stay absent from the index;
   * the push code treats their owners as offline-eligible. */
  userId?: string;
}
