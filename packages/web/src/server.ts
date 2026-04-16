// Fairfox server — signaling relay + legacy sub-app dispatch + static landing.
//
// Under the meshState architecture the server's primary role is the
// WebSocket signaling relay that helps mesh peers discover each other
// for WebRTC connections. It also serves the static landing page, a
// health endpoint, and — during the transition period — dispatches
// requests to legacy sub-apps (todo, struggle) that still run on
// SQLite. The legacy dispatching will be removed in Phase 7 when
// those sub-apps are rebuilt on the mesh baseline.
//
// New sub-apps built from _template do not register data routes here;
// they are standalone Preact clients that connect to the signaling
// relay and sync state peer-to-peer via $meshState.

import { loadEnv } from '@fairfox/shared/env';
import { SIGNALING_PATH } from '@fairfox/shared/signaling';
import type { SubApp, WsData, WsSubApp } from '@fairfox/shared/subapp';
import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { parseWsRole } from './parseWsRole.ts';
import { strip } from './strip.ts';

const env = loadEnv();

// --- Legacy sub-app dispatch (remove in Phase 7) ---

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

// --- Signaling relay (Bun WebSocket, not Elysia, because the main
// server uses Bun.serve directly for legacy sub-app compat) ---

// Signaling state: peer id → WebSocket
const signalingPeers = new Map<string, ServerWebSocket<WsData>>();

function handleSignalingMessage(ws: ServerWebSocket<WsData>, msg: string): void {
  try {
    const parsed = JSON.parse(msg);
    if (parsed.type === 'join' && typeof parsed.peerId === 'string') {
      signalingPeers.set(parsed.peerId, ws);
      return;
    }
    if (
      parsed.type === 'signal' &&
      typeof parsed.peerId === 'string' &&
      typeof parsed.targetPeerId === 'string'
    ) {
      const target = signalingPeers.get(parsed.targetPeerId);
      if (target) {
        target.send(msg);
      } else {
        ws.send(
          JSON.stringify({
            type: 'error',
            reason: 'unknown-target',
            targetPeerId: parsed.targetPeerId,
          })
        );
      }
    }
  } catch {
    // Malformed messages are silently dropped.
  }
}

// --- Static assets ---

const LANDING = Bun.file(`${import.meta.dir}/../public/index.html`);

// --- WebSocket handler: signaling + legacy todo ---

const websocket: WebSocketHandler<WsData> = {
  open(ws) {
    if (ws.data.role === 'client') {
      // Legacy todo WebSocket
      todoApp?.open(ws);
    }
    // Signaling peers don't need an open handler — they join via message.
  },
  message(ws, msg) {
    const text = typeof msg === 'string' ? msg : msg.toString();
    if (ws.data.role === 'signaling') {
      handleSignalingMessage(ws, text);
    } else {
      // Legacy todo
      todoApp?.message(ws, msg);
    }
  },
  close(ws) {
    if (ws.data.role === 'signaling') {
      // Remove from signaling peers
      for (const [peerId, peer] of signalingPeers) {
        if (peer === ws) {
          signalingPeers.delete(peerId);
          break;
        }
      }
    } else {
      todoApp?.close(ws);
    }
  },
};

// --- Main server ---

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

    // Signaling WebSocket upgrade
    if (p === SIGNALING_PATH) {
      if (srv.upgrade(req, { data: { role: 'signaling' } })) {
        return undefined;
      }
      return new Response('Upgrade failed', { status: 400 });
    }

    // LLM proxy — forwards Claude API calls for Speakwell and the
    // family-phone agent. The server holds the ANTHROPIC_API_KEY so
    // client devices never see it. Authentication is by signed
    // request from a paired device (wired up when the agent lands).
    if (p.startsWith('/api/llm/')) {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return Response.json({ error: 'LLM not configured' }, { status: 503 });
      }
      const body = await req.text();
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Legacy sub-app dispatch (remove in Phase 7)
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

const dataInfo = env.DATA_DIR ? ` DATA_DIR=${env.DATA_DIR}` : '';
console.log(`fairfox listening on :${server.port}${dataInfo}`);
