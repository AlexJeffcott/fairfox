import type { ServerWebSocket } from 'bun';

export interface WsData {
  readonly role: 'phone' | 'relay' | 'client' | 'signaling';
  /** Populated by the signalling relay on `join`. Used by the close
   * handler to emit `peer-left` to the remaining incumbents and to
   * evict the peer's entry only if the socket still owns it. */
  peerId?: string;
}

export interface SubApp {
  readonly mount: `/${string}`;
  fetch(req: Request): Promise<Response>;
}

export interface WsSubApp extends SubApp {
  readonly wsPath: `${WsSubApp['mount']}/ws`;
  open(ws: ServerWebSocket<WsData>): void;
  message(ws: ServerWebSocket<WsData>, msg: string | Buffer): void;
  close(ws: ServerWebSocket<WsData>): void;
}
