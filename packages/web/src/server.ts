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
import { zipSync } from 'fflate';
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
async function readBakedBuildHash(): Promise<string | null> {
  try {
    const file = Bun.file('/app/.build-hash');
    if (await file.exists()) {
      const text = (await file.text()).trim();
      return text.length > 0 ? text : null;
    }
  } catch {
    // File missing — local `bun dev` doesn't write it. Fall through.
  }
  return null;
}

export const BUILD_HASH =
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.FAIRFOX_BUILD_HASH ??
  (await readBakedBuildHash()) ??
  `dev-${process.pid}-${Date.now()}`;

// --- Mesh sub-app bundles built at startup ---

const MESH_SUBAPPS = [
  'home',
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

// Pair-return relay state: sessionId → waiting issuer socket. Populated
// by a `pair-issue` frame from the issuer during the pairing ceremony,
// consumed by the matching `pair-return` from the scanner. The map has
// a hard cap (one entry per socket) and a 5-minute TTL; expired entries
// are swept lazily on every message. Nothing outside the pairing flow
// touches this state, so a crash during a ceremony just means the
// user falls back to the existing manual-paste path.
const PAIR_SESSION_TTL_MS = 5 * 60_000;
interface PairSession {
  issuerSocket: ServerWebSocket<WsData>;
  /** Set once a pair-return arrives — the socket that sent it. The
   * issuer uses it to route a `pair-ack` back to the scanner so the
   * scanner (typically `fairfox pair`) knows the handshake completed
   * without having to wait on a timer. */
  scannerSocket?: ServerWebSocket<WsData>;
  createdAt: number;
}
const pairSessions = new Map<string, PairSession>();
const socketPairSessions = new WeakMap<ServerWebSocket<WsData>, string>();

function sweepExpiredPairSessions(now: number): void {
  for (const [sessionId, session] of pairSessions) {
    if (now - session.createdAt > PAIR_SESSION_TTL_MS) {
      pairSessions.delete(sessionId);
      socketPairSessions.delete(session.issuerSocket);
    }
  }
}

function handlePairIssue(ws: ServerWebSocket<WsData>, sessionId: string): void {
  sweepExpiredPairSessions(Date.now());
  // One active session per socket — rejoining overwrites the previous.
  const existing = socketPairSessions.get(ws);
  if (existing && existing !== sessionId) {
    pairSessions.delete(existing);
  }
  pairSessions.set(sessionId, { issuerSocket: ws, createdAt: Date.now() });
  socketPairSessions.set(ws, sessionId);
}

function handlePairReturn(
  ws: ServerWebSocket<WsData>,
  sessionId: string,
  token: string,
  extras: { agent?: string; name?: string }
): void {
  sweepExpiredPairSessions(Date.now());
  const session = pairSessions.get(sessionId);
  if (!session) {
    try {
      ws.send(JSON.stringify({ type: 'pair-error', sessionId, reason: 'session-not-found' }));
    } catch {
      // best effort
    }
    return;
  }
  // Remember the scanner's socket so a subsequent pair-ack from the
  // issuer can route back to it. Don't delete the session yet — the
  // ack completes the handshake.
  session.scannerSocket = ws;
  const forwarded: Record<string, unknown> = { type: 'pair-return', sessionId, token };
  if (typeof extras.agent === 'string') {
    forwarded.agent = extras.agent;
  }
  if (typeof extras.name === 'string') {
    forwarded.name = extras.name;
  }
  try {
    session.issuerSocket.send(JSON.stringify(forwarded));
  } catch {
    // issuer socket is gone; the scanner's own fallback path still works.
  }
}

function handlePairAck(ws: ServerWebSocket<WsData>, sessionId: string): void {
  sweepExpiredPairSessions(Date.now());
  const session = pairSessions.get(sessionId);
  if (!session) {
    return;
  }
  // Only accept the ack from the socket that issued the pair-issue —
  // otherwise any peer who knows the session id could forge it.
  if (session.issuerSocket !== ws) {
    return;
  }
  const scanner = session.scannerSocket;
  if (scanner) {
    try {
      scanner.send(JSON.stringify({ type: 'pair-ack', sessionId }));
    } catch {
      // scanner already closed; nothing further to do.
    }
  }
  pairSessions.delete(sessionId);
  socketPairSessions.delete(session.issuerSocket);
}

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
      return;
    }
    if (parsed.type === 'pair-issue' && typeof parsed.sessionId === 'string') {
      handlePairIssue(ws, parsed.sessionId);
      return;
    }
    if (
      parsed.type === 'pair-return' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      handlePairReturn(ws, parsed.sessionId, parsed.token, {
        agent: typeof parsed.agent === 'string' ? parsed.agent : undefined,
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
      });
      return;
    }
    if (parsed.type === 'pair-ack' && typeof parsed.sessionId === 'string') {
      handlePairAck(ws, parsed.sessionId);
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
  // Drop any pair-return session this socket was waiting on; the scanner's
  // next POST would just bounce off a 404.
  const sessionId = socketPairSessions.get(ws);
  if (sessionId !== undefined) {
    pairSessions.delete(sessionId);
    socketPairSessions.delete(ws);
  }
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

const CLI_BUNDLE = Bun.file(`${import.meta.dir}/../../cli/dist/fairfox.js`);
// SHA-256 of the CLI bundle bytes. Computed once at startup and served
// from `/cli/version` so the installed CLI can opportunistically notice
// drift and offer `fairfox update` rather than asking every user to
// remember to re-run the curl installer.
const CLI_BUNDLE_SHA = await (async () => {
  try {
    const bytes = new Uint8Array(await CLI_BUNDLE.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
})();

// The Chrome side-panel extension is pre-built at image time
// (`packages/extension/dist/`). The server reads every file of that
// unpacked extension into memory at startup so the download endpoint can
// stream a per-request zip with the pairing token baked into
// `panel.html` — the same ergonomic as `/cli/install?token=`.
const EXTENSION_DIR = `${import.meta.dir}/../../extension/dist`;
const EXTENSION_FILES = [
  'manifest.json',
  'panel.html',
  'background.js',
  'icon16.png',
  'icon48.png',
  'icon128.png',
] as const;
const extensionBaseFiles = new Map<string, Uint8Array>();
try {
  for (const name of EXTENSION_FILES) {
    const file = Bun.file(`${EXTENSION_DIR}/${name}`);
    if (await file.exists()) {
      extensionBaseFiles.set(name, new Uint8Array(await file.arrayBuffer()));
    }
  }
} catch {
  // Extension dist missing — the /extension route will 503 until the
  // build step runs. Local `bun dev` users who haven't built the
  // extension see the 503 and run `bun --cwd packages/extension build`.
}

// Static assets served from `packages/web/public/` at the site root so a
// browser visiting `/manifest.webmanifest`, `/sw.js`, or `/icon.svg` reaches
// them directly. Each one has a specific Content-Type and cache stance:
// the manifest and icons are fingerprint-free but small enough to re-serve
// on every navigation without pain, while the service worker must never be
// cached past its current byte-for-byte contents (a stale worker locks out
// new installs) so it ships with `Cache-Control: no-store`.
const PUBLIC_DIR = `${import.meta.dir}/../public`;
const STATIC_ASSETS: Record<string, { path: string; contentType: string; cacheControl: string }> = {
  '/manifest.webmanifest': {
    path: `${PUBLIC_DIR}/manifest.webmanifest`,
    contentType: 'application/manifest+json; charset=utf-8',
    cacheControl: 'public, max-age=300',
  },
  '/sw.js': {
    path: `${PUBLIC_DIR}/sw.js`,
    contentType: 'application/javascript; charset=utf-8',
    cacheControl: 'no-store',
  },
  '/icon.svg': {
    path: `${PUBLIC_DIR}/icon.svg`,
    contentType: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=86400',
  },
  '/icon-maskable.svg': {
    path: `${PUBLIC_DIR}/icon-maskable.svg`,
    contentType: 'image/svg+xml; charset=utf-8',
    cacheControl: 'public, max-age=86400',
  },
};

// --- CLI installer ---
//
// Pipe-to-bash script served from /cli/install. Takes an optional
// pairing token so a single copy-paste both installs and pairs.

function renderInstallScript(origin: string, token: string, sessionId: string): string {
  // Pair tokens are standard base64 (`+`, `/`, `=`), arrived here
  // already URL-decoded by `searchParams.get`. The whitelist covers
  // that alphabet plus the URL-encoding / URL-safe-base64 characters
  // in case a double-encoded token reaches us. `JSON.stringify` below
  // handles shell-quoting via double quotes; we don't need to strip
  // any of these characters to keep the generated script safe.
  const safeToken = token.replace(/[^A-Za-z0-9%+/=._~-]/g, '');
  // The session id is a short URL-safe base64 string, so a tighter
  // whitelist is fine. Used by the installer to pass --session to
  // `fairfox pair` so the CLI can emit a pair-return frame that
  // tells the issuer's browser tab about the CLI's identity.
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
  // Bundle lives on GitHub Releases so CLI-only changes don't need
  // a Railway deploy. /releases/latest/download is GitHub's stable
  // redirect to the newest release's asset of the same filename.
  const bundleUrl = 'https://github.com/AlexJeffcott/fairfox/releases/latest/download/fairfox.js';
  void origin;
  return `#!/bin/sh
# fairfox CLI installer. Drops the fairfox binary at
# $HOME/.local/bin/fairfox and, if a pairing token was handed to the
# installer URL, applies it to a fresh keyring at $HOME/.fairfox.
set -e

BIN_DIR="$HOME/.local/bin"
SCRIPT_PATH="$HOME/.fairfox/fairfox.js"
BIN_PATH="$BIN_DIR/fairfox"
TOKEN=${JSON.stringify(safeToken)}
SESSION_ID=${JSON.stringify(safeSessionId)}

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
# NODE_NO_WARNINGS=1 silences Node's process-level warning stream.
# Two upstream warnings bleed through every fairfox invocation and
# carry no actionable signal: xstate inside polly schedules delayed
# events whose target time is sometimes in the past, tripping
# TimeoutNegativeWarning; and automerge-wasm calls the legacy
# initSync() shape, tripping a DeprecationWarning. An in-bundle
# process.on('warning') filter doesn't catch them because ES
# module imports hoist above it — installing the filter here, at
# the wrapper layer, runs before any JS.
exec env NODE_NO_WARNINGS=1 bun "$HOME/.fairfox/fairfox.js" "$@"
WRAPPER
chmod +x "$BIN_PATH"

echo "Installed fairfox → $BIN_PATH"
case ":$PATH:" in
  *:"$BIN_DIR":*) ;;
  *) echo "note: $BIN_DIR is not on your \\$PATH — add it or run \\"\\$BIN_DIR/fairfox\\" directly." ;;
esac

if [ -n "$TOKEN" ]; then
  if [ -n "$SESSION_ID" ]; then
    "$BIN_PATH" pair "$TOKEN" --session "$SESSION_ID"
  else
    "$BIN_PATH" pair "$TOKEN"
  fi
fi
`;
}

// --- Extension download ---
//
// Builds a per-request Chrome extension zip. The pre-built unpacked
// extension from `packages/extension/dist/` is the base; the only file
// that changes per download is `panel.html`, whose iframe `src` is
// rewritten to include a `#pair=<token>` fragment. The fairfox app
// inside the frame already consumes that fragment through `MeshGate`,
// so loading the extension for the first time pairs the device without
// the user touching a QR scanner.
//
// Serving from memory rather than a cached zip file keeps the download
// single-use by construction: every token gets its own bytes, and the
// server never stores a long-lived zip on disk.
function renderExtensionPanelHtml(origin: string, token: string): string {
  const panel = extensionBaseFiles.get('panel.html');
  if (!panel) {
    throw new Error('panel.html missing from extension dist');
  }
  const baseUrl = origin;
  const pairedUrl = token ? `${baseUrl}/#pair=${encodeURIComponent(token)}` : baseUrl;
  return new TextDecoder().decode(panel).replace(/src="[^"]*"/, `src="${pairedUrl}"`);
}

function buildExtensionZip(origin: string, token: string): Uint8Array {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const [name, bytes] of extensionBaseFiles) {
    if (name === 'panel.html') {
      files[name] = encoder.encode(renderExtensionPanelHtml(origin, token));
    } else {
      files[name] = bytes;
    }
  }
  return zipSync(files, { level: 6 });
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

// Railway's TLS terminator forwards requests to the container over plain
// HTTP, so `req.url` reports `http://...` even when the user reached the
// site over HTTPS. `X-Forwarded-Proto` carries the real scheme; preferring
// it keeps the origin string we bake into install scripts, extension
// panels, and pairing URLs matched to what the browser actually uses.
function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get('x-forwarded-proto');
  const forwardedHost = req.headers.get('x-forwarded-host');
  const scheme = forwardedProto ?? url.protocol.replace(/:$/, '');
  const host = forwardedHost ?? url.host;
  return `${scheme}://${host}`;
}

const server = Bun.serve<WsData>({
  port: env.PORT,
  async fetch(req, srv) {
    const p = new URL(req.url).pathname;

    if (p === '/health') {
      return Response.json({ ok: true });
    }

    if (p === '/' || p === '/index.html') {
      const homeBundle = bundles.get('home');
      if (!homeBundle) {
        return new Response('home bundle not available', { status: 503 });
      }
      return new Response(homeBundle.html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (p === '/build-hash') {
      return Response.json({ hash: BUILD_HASH }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const staticAsset = STATIC_ASSETS[p];
    if (staticAsset) {
      return new Response(Bun.file(staticAsset.path), {
        headers: {
          'Content-Type': staticAsset.contentType,
          'Cache-Control': staticAsset.cacheControl,
        },
      });
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
    if (p === '/cli/version') {
      return new Response(JSON.stringify({ sha256: CLI_BUNDLE_SHA }), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    if (p === '/cli/install.sh' || p === '/cli/install') {
      const params = new URL(req.url).searchParams;
      const token = params.get('token') ?? '';
      const sessionId = params.get('s') ?? '';
      const origin = publicOrigin(req);
      const script = renderInstallScript(origin, token, sessionId);
      return new Response(script, {
        headers: {
          'Content-Type': 'text/x-shellscript; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (p === '/extension/fairfox.zip') {
      if (extensionBaseFiles.size === 0) {
        return new Response(
          'extension bundle not available — run `bun --cwd packages/extension build` first',
          { status: 503 }
        );
      }
      const token = new URL(req.url).searchParams.get('token') ?? '';
      const origin = publicOrigin(req);
      const zip = buildExtensionZip(origin, token);
      const buffer = new ArrayBuffer(zip.byteLength);
      new Uint8Array(buffer).set(zip);
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="fairfox-extension.zip"',
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
        // The HTML shell carries the build-hash meta, which must match
        // what `/build-hash` reports. Without `no-store` Railway's Fastly
        // edge caches the shell for minutes while the endpoint stays
        // fresh, and the BuildFreshnessBanner treats the permanent
        // disagreement as a pending reload.
        return new Response(bundle.html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
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
