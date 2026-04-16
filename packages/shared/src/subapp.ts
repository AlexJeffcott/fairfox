import type { ServerWebSocket } from 'bun';

export interface WsData {
  readonly role: 'phone' | 'relay' | 'client' | 'signaling';
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
