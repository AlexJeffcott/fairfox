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
import { buildAllSubApps } from './bundle-subapp.ts';
import { parseWsRole } from './parseWsRole.ts';
import { strip } from './strip.ts';

const env = loadEnv();

// --- Build-hash freshness ---
//
// Every open tab caches the JS bundle and CSS chunks it loaded from
// the previous deploy. A Railway push replaces both without the tab's
// knowing, and a user can go weeks running old code that still appears
// to work — until a protocol change (action handler rename, $meshState
// key change, anything) diverges the local app from the server it talks
// to. The symptom the user reported: "seems like it gets stale and
// disconnected until I refresh."
//
// The fix is two-sided. Server exposes a stable build identifier both
// as a meta tag in every sub-app HTML shell and as a `/build-hash`
// JSON endpoint. Client reads the meta on load, polls the endpoint on
// an interval, and when the hash diverges prompts the user to reload
// through a small banner.
//
// Hash sources, in priority order:
//   1. RAILWAY_GIT_COMMIT_SHA — set automatically by Railway per deploy.
//   2. FAIRFOX_BUILD_HASH — escape hatch for other hosting providers
//      (DigitalOcean, Fly.io) and for local e2e tests that need to
//      simulate two different deploys back-to-back.
//   3. A per-process fallback so the signal is always non-empty and
//      local `bun dev` never spams the banner on itself.
export const BUILD_HASH =
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.FAIRFOX_BUILD_HASH ??
  `dev-${process.pid}-${Date.now()}`;

function injectBuildHashMeta(html: string, hash: string): string {
  const meta = `<meta name="fairfox-build-hash" content="${hash}" />`;
  // Prefer to place the meta tag in <head>. If the document lacks a
  // head tag the meta slots in right after <html> so the client can
  // still find it through `document.querySelector`.
  if (html.includes('</head>')) {
    return html.replace('</head>', `    ${meta}\n  </head>`);
  }
  return html.replace('<html', `<html>\n  ${meta}\n<html`).replace('<html>\n', '<html');
}

// --- Mesh sub-app bundles built at startup ---

const MESH_SUBAPPS = [
  'agenda',
  'todo-v2',
  'the-struggle',
  'library',
  'speakwell',
  'family-phone-admin',
] as const;

const bundles = await buildAllSubApps(MESH_SUBAPPS, BUILD_HASH);

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
//
// The wire protocol matches @fairfox/polly/elysia's signalingServer
// plugin so paired devices can discover each other reactively rather
// than relying on a one-shot startup sweep:
//
//   Client → server:   `join`, `signal`
//   Server → newcomer: `peers-present` on each join
//   Server → incumbents: `peer-joined` on each join, `peer-left` on each close
//   Server → sender:   `error` on unknown-target / not-joined / malformed
//
// Adopting the polly reference plugin wholesale would mean threading
// Elysia into the existing Bun.serve; for now we mirror the frames
// here and keep the legacy-todo dispatch untouched. The signalling
// server is stateless — no persistent queue, no routing across
// instances — which keeps the single-process Railway deployment
// correct without extra infrastructure.

// Signaling state: peer id → WebSocket
const signalingPeers = new Map<string, ServerWebSocket<WsData>>();

function handleSignalingMessage(ws: ServerWebSocket<WsData>, msg: string): void {
  try {
    const parsed = JSON.parse(msg);
    if (parsed.type === 'join' && typeof parsed.peerId === 'string') {
      handleJoin(ws, parsed.peerId);
      return;
    }
    if (
      parsed.type === 'signal' &&
      typeof parsed.peerId === 'string' &&
      typeof parsed.targetPeerId === 'string'
    ) {
      handleSignal(ws, msg, parsed.targetPeerId);
    }
  } catch {
    // Malformed messages are silently dropped.
  }
}

function handleJoin(ws: ServerWebSocket<WsData>, peerId: string): void {
  // Snapshot the incumbents before inserting the newcomer so we can
  // tell the newcomer who is already present and tell each of them
  // about the newcomer. A rejoin with the same peerId replaces the
  // prior entry but is otherwise treated as a fresh arrival.
  const incumbents: Array<{ peerId: string; socket: ServerWebSocket<WsData> }> = [];
  for (const [existingPeerId, existingSocket] of signalingPeers) {
    if (existingPeerId === peerId) {
      continue;
    }
    incumbents.push({ peerId: existingPeerId, socket: existingSocket });
  }
  signalingPeers.set(peerId, ws);
  (ws.data as WsData).peerId = peerId;

  ws.send(
    JSON.stringify({
      type: 'peers-present',
      peerIds: incumbents.map((i) => i.peerId),
    })
  );

  const notice = JSON.stringify({ type: 'peer-joined', peerId });
  for (const incumbent of incumbents) {
    try {
      incumbent.socket.send(notice);
    } catch {
      // The incumbent's own close handler will evict it.
    }
  }
}

function handleSignal(ws: ServerWebSocket<WsData>, raw: string, targetPeerId: string): void {
  const target = signalingPeers.get(targetPeerId);
  if (!target) {
    ws.send(
      JSON.stringify({
        type: 'error',
        reason: 'unknown-target',
        targetPeerId,
      })
    );
    return;
  }
  target.send(raw);
}

function handleSignalingClose(ws: ServerWebSocket<WsData>): void {
  const peerId = ws.data.peerId;
  if (!peerId) {
    return;
  }
  // Only evict if the map still points at *this* socket. A stale
  // close after the same peerId rejoined on a new socket must not
  // take the fresh entry with it.
  if (signalingPeers.get(peerId) !== ws) {
    return;
  }
  signalingPeers.delete(peerId);
  const notice = JSON.stringify({ type: 'peer-left', peerId });
  for (const [, incumbentSocket] of signalingPeers) {
    try {
      incumbentSocket.send(notice);
    } catch {
      // Incumbent's own close handler will tidy.
    }
  }
}

// --- Static assets ---

const LANDING_HTML = injectBuildHashMeta(
  await Bun.file(`${import.meta.dir}/../public/index.html`).text(),
  BUILD_HASH
);
const CLI_BUNDLE = Bun.file(`${import.meta.dir}/../../cli/dist/fairfox.js`);

// --- CLI installer ---
//
// Pipe-to-bash script served from /cli/install. Takes an optional
// pairing token so a single copy-paste both installs and pairs.

function renderInstallScript(origin: string, token: string): string {
  const safeToken = token.replace(/[^A-Za-z0-9%._~-]/g, '');
  const bundleUrl = `${origin}/cli/fairfox.js`;
  return `#!/bin/sh
# fairfox CLI installer. Drops the fairfox binary at
# $HOME/.local/bin/fairfox and, if a pairing token was handed to the
# installer URL, applies it to a fresh keyring at $HOME/.fairfox.
set -e

BIN_DIR="$HOME/.local/bin"
SCRIPT_PATH="$HOME/.fairfox/fairfox.js"
BIN_PATH="$BIN_DIR/fairfox"
TOKEN=${JSON.stringify(safeToken)}

if ! command -v bun >/dev/null 2>&1; then
  echo "fairfox install: bun is required. Install it first:" >&2
  echo "  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$HOME/.fairfox"
echo "Fetching CLI bundle…"
curl -fsSL ${JSON.stringify(bundleUrl)} -o "$SCRIPT_PATH"
cat > "$BIN_PATH" <<'WRAPPER'
#!/bin/sh
exec bun "$HOME/.fairfox/fairfox.js" "$@"
WRAPPER
chmod +x "$BIN_PATH"

echo "Installed fairfox → $BIN_PATH"
case ":$PATH:" in
  *:"$BIN_DIR":*) ;;
  *) echo "note: $BIN_DIR is not on your \\$PATH — add it or run \\"\\$BIN_DIR/fairfox\\" directly." ;;
esac

if [ -n "$TOKEN" ]; then
  "$BIN_PATH" pair "$TOKEN"
fi
`;
}

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
      handleSignalingClose(ws);
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
      return new Response(LANDING_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (p === '/build-hash') {
      return Response.json({ hash: BUILD_HASH }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // CLI distribution.
    //
    // The CLI bundle ships in the same Docker image as the server, so
    // the version a user installs is always the version the server
    // speaks. The installer script takes an optional `token` query
    // parameter and appends `fairfox pair <token>` on a fresh install,
    // which lets the browser's "Pair a CLI" reveal hand a user one
    // command that both downloads and pairs in a single step.
    if (p === '/cli/fairfox.js') {
      return new Response(CLI_BUNDLE, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    if (p === '/cli/install.sh' || p === '/cli/install') {
      const token = new URL(req.url).searchParams.get('token') ?? '';
      const origin = `${new URL(req.url).protocol}//${new URL(req.url).host}`;
      const script = renderInstallScript(origin, token);
      return new Response(script, {
        headers: {
          'Content-Type': 'text/x-shellscript; charset=utf-8',
          'Cache-Control': 'no-store',
        },
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

    // Mesh sub-app dispatch — serves the bundled client for any sub-app
    // registered in MESH_SUBAPPS. The HTML shell is served for the root
    // path of each sub-app; built artefacts (JS, CSS, source maps) are
    // served under the sub-app prefix from the in-memory bundle manifest.
    for (const name of MESH_SUBAPPS) {
      const prefix = `/${name}`;
      if (p === prefix || p === `${prefix}/`) {
        const bundle = bundles.get(name);
        if (!bundle) {
          return new Response(`${name} bundle not available`, { status: 503 });
        }
        return new Response(bundle.html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (p.startsWith(`${prefix}/`)) {
        const bundle = bundles.get(name);
        if (!bundle) {
          return new Response('Not Found', { status: 404 });
        }
        const artefactPath = p.slice(prefix.length);
        const artefact = bundle.artefacts.get(artefactPath);
        if (!artefact) {
          return new Response('Not Found', { status: 404 });
        }
        return new Response(artefact.body, {
          headers: { 'Content-Type': artefact.contentType },
        });
      }
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
