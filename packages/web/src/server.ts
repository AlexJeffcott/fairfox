import { loadEnv } from '@fairfox/shared/env';
import type { SubApp, WsData, WsSubApp } from '@fairfox/shared/subapp';
import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { parseWsRole } from './parseWsRole.ts';
import { strip } from './strip.ts';

const env = loadEnv();

type SubAppNs = { fetch(req: Request): Promise<Response>; mount: `/${string}` };
type WsSubAppNs = SubAppNs & {
  wsPath: `/${string}/ws`;
  open(ws: ServerWebSocket<WsData>): void;
  message(ws: ServerWebSocket<WsData>, msg: string | Buffer): void;
  close(ws: ServerWebSocket<WsData>): void;
};

let struggleApp: SubApp | null = null;
async function getStruggle(): Promise<SubApp> {
  if (struggleApp) {
    return struggleApp;
  }
  const ns: SubAppNs = await import('@fairfox/struggle');
  struggleApp = ns;
  return struggleApp;
}

let todoApp: WsSubApp | null = null;
async function getTodo(): Promise<WsSubApp> {
  if (todoApp) {
    return todoApp;
  }
  const ns: WsSubAppNs = await import('@fairfox/todo');
  todoApp = ns;
  return todoApp;
}

const LANDING = Bun.file(`${import.meta.dir}/../public/index.html`);

const websocket: WebSocketHandler<WsData> = {
  open(ws) {
    todoApp?.open(ws);
  },
  message(ws, msg) {
    todoApp?.message(ws, msg);
  },
  close(ws) {
    todoApp?.close(ws);
  },
};

const server = Bun.serve<WsData>({
  port: env.PORT,
  async fetch(req, srv) {
    const p = new URL(req.url).pathname;

    if (p === '/health') {
      return Response.json({ ok: true });
    }
    if (p === '/' || p === '/index.html') {
      return new Response(LANDING, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (p === '/todo/ws') {
      const role = parseWsRole(new URL(req.url));
      await getTodo();
      if (srv.upgrade(req, { data: { role } })) {
        return undefined;
      }
      return new Response('Upgrade failed', { status: 400 });
    }

    if (p === '/todo' || p.startsWith('/todo/')) {
      const t = await getTodo();
      return t.fetch(strip(req, '/todo'));
    }

    if (p === '/struggle' || p.startsWith('/struggle/')) {
      const s = await getStruggle();
      return s.fetch(strip(req, '/struggle'));
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket,
});

console.log(`fairfox listening on :${server.port} (DATA_DIR=${env.DATA_DIR})`);
