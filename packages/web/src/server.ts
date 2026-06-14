// Fairfox server — signaling relay + unified mesh SPA + static landing.
//
// The server's primary job is the WebSocket signaling relay that helps
// mesh peers discover each other for WebRTC connections. It also
// serves the unified Preact SPA (one bundle, one HTML shell for every
// mesh route), the CLI installer script, the Chrome side-panel
// extension download, and a handful of small APIs. The legacy
// sub-apps (packages/todo on raw Bun.serve and packages/struggle on
// Elysia) have been retired — their data migrated into todo-v2's
// mesh documents.

import { createHmac } from 'node:crypto';
import { loadEnv } from '@fairfox/shared/env';
import { SIGNALING_PATH } from '@fairfox/shared/signaling';
import type { WsData } from '@fairfox/shared/subapp';
import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { zipSync } from 'fflate';
import webpush from 'web-push';
import { type AppBundle, fetchApp } from './fetch-app.ts';

const APP_PACKAGE = 'home';

const env = loadEnv();

// Configure web-push if VAPID keys are present. Without this call the
// library throws on every `sendNotification`; with it, calls bind the
// VAPID subject + key pair as the sender identity on every push.
if (env.FAIRFOX_VAPID_PUBLIC_KEY && env.FAIRFOX_VAPID_PRIVATE_KEY && env.FAIRFOX_VAPID_SUBJECT) {
  webpush.setVapidDetails(
    env.FAIRFOX_VAPID_SUBJECT,
    env.FAIRFOX_VAPID_PUBLIC_KEY,
    env.FAIRFOX_VAPID_PRIVATE_KEY
  );
}

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

// --- Mesh SPA bundle built at startup ---
//
// The whole mesh UI ships as one Preact SPA mounted from
// `packages/home`'s boot. The sub-app routes (/todo-v2, /agenda,
// /library, /family-phone-admin, /speakwell, /the-struggle) all
// serve the same HTML shell and JS bundle; the client-side router
// reads `location.pathname` and renders the right sub-app.
// MESH_ROUTES enumerates the paths that belong to the SPA — any
// request for one of these returns the unified HTML. Asset
// requests go through `/<APP_PACKAGE>/*.js` / `*.css` where
// APP_PACKAGE is the package the bundle was built from.

const MESH_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/index.html',
  '/todo-v2',
  '/agenda',
  '/chat',
  '/docs',
  '/library',
  '/family-phone-admin',
  '/speakwell',
  '/the-struggle',
]);

let appBundle: AppBundle | null = null;
let lastBundleRefresh = 0;
const REFRESH_DEBOUNCE_MS = 5_000;

async function refreshAppBundle(): Promise<AppBundle | null> {
  const next = await fetchApp();
  if (next) {
    appBundle = next;
    lastBundleRefresh = Date.now();
    console.log(`[fetch-app] ${appBundle.tag}: ${appBundle.artefacts.size} artefact(s) ready`);
  } else {
    console.error('[fetch-app] no bundle available (network and disk cache both failed)');
  }
  return appBundle;
}

await refreshAppBundle();

const REFRESH_TOKEN = process.env.FAIRFOX_REFRESH_TOKEN?.trim() ?? '';

// --- Legacy sub-app dispatch (remove in Phase 7) ---

// --- Signaling relay (Bun WebSocket) ---
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

// Push request shapes accepted by `POST /push/send`. Defined here
// rather than in @fairfox/shared because the relay is the only Bun
// surface that imports them; the SPA-side equivalents live in
// `@fairfox/shared/push-client` (it sends, doesn't receive).
interface PushTargetSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}
interface PushWakePayload {
  kind: string;
  title: string;
  body: string;
  tag: string;
  url: string;
}
interface PushSendRequest {
  recipientUserId: string;
  payload: PushWakePayload;
  targets: PushTargetSubscription[];
}
interface PushTargetResult {
  endpoint: string;
  status: number;
  ok: boolean;
}
function isWebPushError(err: unknown): err is { statusCode: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'
  );
}

// userId → set of peerIds currently joined. Populated on every `join`
// frame whose payload includes a `userId` (older client builds omit
// it — the entry stays absent and the push code treats them as
// offline-eligible). The relay consults this map on `POST /push/send`
// to short-circuit pushes to users who already have a live signalling
// socket — they'll get the update through the mesh in milliseconds
// and a redundant notification would buzz the phone for nothing.
//
// Today polly's signalling client emits join without userId, so this
// map stays empty in practice and the online-skip never fires. The
// index code is kept ready for a future polly tweak (or a custom
// `user-announce` frame) that supplies userId; until then the
// sender-side check via peersPresent is the only online-gate.
const userIdToPeerIds = new Map<string, Set<string>>();

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
  extras: { agent?: string; name?: string; userId?: string }
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
  if (typeof extras.userId === 'string') {
    forwarded.userId = extras.userId;
  }
  try {
    session.issuerSocket.send(JSON.stringify(forwarded));
  } catch {
    // issuer socket is gone; the scanner's own fallback path still works.
  }
}

function handlePairAck(
  ws: ServerWebSocket<WsData>,
  sessionId: string,
  payload: string | undefined
): void {
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
    // `payload`, when present, is the issuer's identity blob (recovery
    // or invite) encrypted under the ephemeral key carried only in the
    // QR — the relay never sees that key, so it forwards ciphertext it
    // cannot read. The scanner decrypts it to finish onboarding.
    const ack: Record<string, unknown> = { type: 'pair-ack', sessionId };
    if (typeof payload === 'string') {
      ack.payload = payload;
    }
    try {
      scanner.send(JSON.stringify(ack));
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
      const userId = typeof parsed.userId === 'string' ? parsed.userId : undefined;
      handleJoin(ws, parsed.peerId, userId);
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
        userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
      });
      return;
    }
    if (parsed.type === 'pair-ack' && typeof parsed.sessionId === 'string') {
      handlePairAck(
        ws,
        parsed.sessionId,
        typeof parsed.payload === 'string' ? parsed.payload : undefined
      );
    }
  } catch {
    // Malformed messages are silently dropped.
  }
}

function handleJoin(ws: ServerWebSocket<WsData>, peerId: string, userId: string | undefined): void {
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
  // If this socket was previously joined under a different peerId or
  // userId, evict the stale entries before inserting the new pair.
  const priorPeerId = ws.data.peerId;
  const priorUserId = ws.data.userId;
  if (priorPeerId && priorPeerId !== peerId && signalingPeers.get(priorPeerId) === ws) {
    signalingPeers.delete(priorPeerId);
  }
  if (priorUserId && priorPeerId) {
    const priorSet = userIdToPeerIds.get(priorUserId);
    if (priorSet) {
      priorSet.delete(priorPeerId);
      if (priorSet.size === 0) {
        userIdToPeerIds.delete(priorUserId);
      }
    }
  }
  signalingPeers.set(peerId, ws);
  ws.data.peerId = peerId;
  if (userId) {
    ws.data.userId = userId;
    let set = userIdToPeerIds.get(userId);
    if (!set) {
      set = new Set();
      userIdToPeerIds.set(userId, set);
    }
    set.add(peerId);
  }

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
  const userId = ws.data.userId;
  if (userId) {
    const set = userIdToPeerIds.get(userId);
    if (set) {
      set.delete(peerId);
      if (set.size === 0) {
        userIdToPeerIds.delete(userId);
      }
    }
  }
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
  '/.well-known/security.txt': {
    path: `${PUBLIC_DIR}/.well-known/security.txt`,
    contentType: 'text/plain; charset=utf-8',
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

// --- WebSocket handler: signaling ---

const websocket: WebSocketHandler<WsData> = {
  open() {
    // Signaling peers don't need an open handler — they join via message.
  },
  message(ws, msg) {
    const text = typeof msg === 'string' ? msg : msg.toString();
    if (ws.data.role === 'signaling') {
      handleSignalingMessage(ws, text);
    }
  },
  close(ws) {
    if (ws.data.role === 'signaling') {
      handleSignalingClose(ws);
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

// Optional TLS — when both FAIRFOX_TLS_KEY_FILE and
// FAIRFOX_TLS_CERT_FILE are set, the relay binds over HTTPS. Used
// for local dev so the SPA runs as a secure context (Web Push,
// Notification permission, secure WebSocket). Fly/Railway terminate
// TLS upstream so prod leaves these unset.
const tlsOptions =
  env.FAIRFOX_TLS_KEY_FILE && env.FAIRFOX_TLS_CERT_FILE
    ? { key: Bun.file(env.FAIRFOX_TLS_KEY_FILE), cert: Bun.file(env.FAIRFOX_TLS_CERT_FILE) }
    : undefined;
if (tlsOptions) {
  console.log(`[fairfox] TLS enabled (key=${env.FAIRFOX_TLS_KEY_FILE})`);
}

const server = Bun.serve<WsData>({
  port: env.PORT,
  ...(tlsOptions ? { tls: tlsOptions } : {}),
  async fetch(req, srv) {
    const p = new URL(req.url).pathname;

    if (p === '/health') {
      return Response.json({ ok: true });
    }

    // ICE server credentials.
    //
    // WebRTC peers fetch this once at connect time to learn which
    // STUN/TURN servers to offer in their ICE candidate list. The
    // STUN entry is always returned (cheap, host/srflx coverage);
    // the TURN entry is only included when the relay has been
    // deployed alongside a coturn `fairfox-turn` service and given
    // the shared secret. Without a TURN entry, peers behind symmetric
    // NAT (CGNAT, corporate firewalls) and browser↔CLI pairs on the
    // same LAN (where Chrome's mDNS obfuscation hides host
    // candidates from werift) cannot establish a data channel.
    //
    // Credentials use coturn's `use-auth-secret` REST mode — username
    // is `<expiresAtUnix>:<tag>`, credential is base64(HMAC-SHA1(secret,
    // username)). TTL is bounded so a leaked pair has minutes of
    // useful life, not days. Short-lived refetch is the resolver's
    // responsibility on the client side.
    if (p === '/turn-credentials') {
      const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> =
        [{ urls: 'stun:stun.cloudflare.com:3478' }];
      if (env.FAIRFOX_TURN_URL && env.FAIRFOX_TURN_SHARED_SECRET) {
        const expiresAt = Math.floor(Date.now() / 1000) + env.FAIRFOX_TURN_TTL_SECONDS;
        const tag = crypto.randomUUID().slice(0, 8);
        const username = `${expiresAt}:fairfox-${tag}`;
        const credential = createHmac('sha1', env.FAIRFOX_TURN_SHARED_SECRET)
          .update(username)
          .digest('base64');
        iceServers.push({ urls: env.FAIRFOX_TURN_URL, username, credential });
      }
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      if (!env.FAIRFOX_TURN_URL) {
        headers.Warning =
          '299 - "FAIRFOX_TURN_URL not set: peers behind CGNAT or browser<->CLI on the same LAN may not pair"';
      }
      return Response.json({ iceServers, ttlSeconds: env.FAIRFOX_TURN_TTL_SECONDS }, { headers });
    }

    // Any route recognised by the mesh SPA returns the same HTML
    // shell; the client-side router reads location.pathname and
    // swaps the right sub-app in without a document fetch on
    // subsequent navigations.
    if (MESH_ROUTES.has(p)) {
      if (!appBundle) {
        return new Response('app bundle not available', { status: 503 });
      }
      return new Response(appBundle.html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Web Push — the public half of the VAPID keypair. The SPA reads
    // this once on boot and hands it to `pushManager.subscribe`, which
    // binds the subscription to this server's identity. Returns 503
    // when VAPID isn't configured so the client knows to skip the
    // subscription flow entirely. Cached for an hour: the keypair is
    // long-lived (rotation invalidates every subscription) so refetch
    // pressure is wasted bandwidth.
    if (p === '/push/vapid-public-key') {
      if (!env.FAIRFOX_VAPID_PUBLIC_KEY) {
        return new Response('VAPID not configured', { status: 503 });
      }
      return Response.json(
        { publicKey: env.FAIRFOX_VAPID_PUBLIC_KEY },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    // Web Push — delivery proxy. Any mesh peer can POST a wake intent
    // here; the relay applies the online-skip gate (see
    // `userIdToPeerIds` above) and, for offline recipients, hands each
    // target subscription + payload to the `web-push` library, which
    // performs RFC 8291 payload encryption and VAPID JWT signing
    // against the vendor endpoint baked into the subscription.
    //
    // The relay sees plaintext payloads in flight — same trust
    // posture as `/api/llm/*` above, which already proxies plaintext
    // LLM conversations. The single-operator family mesh accepts this
    // tradeoff in exchange for a much simpler implementation than a
    // hand-rolled RFC 8291 in the sender's browser. Revisit if the
    // trust model widens (relay operated by a third party, mesh
    // members not all related, etc.).
    //
    // Request body:
    //   {
    //     recipientUserId: string;       // skip when this user is live
    //     payload: WakePayload;          // shown on the device
    //     targets: PushSubscriptionRecord[];
    //   }
    // Response: { skipped?: 'user-online'; results?: PerTargetResult[] }
    // where PerTargetResult = { endpoint: string; status: number; ok: boolean }.
    if (p === '/push/send' && req.method === 'POST') {
      if (!env.FAIRFOX_VAPID_PUBLIC_KEY) {
        return new Response('VAPID not configured', { status: 503 });
      }
      let body: PushSendRequest;
      try {
        body = (await req.json()) as PushSendRequest;
      } catch {
        return Response.json({ error: 'invalid JSON' }, { status: 400 });
      }
      if (
        typeof body.recipientUserId !== 'string' ||
        !body.payload ||
        typeof body.payload !== 'object' ||
        !Array.isArray(body.targets)
      ) {
        return Response.json({ error: 'malformed request' }, { status: 400 });
      }
      // Online-skip — the relay's signalling table is the source of
      // truth for "is the recipient connected right now?". Any peer
      // owned by the recipient being present is enough to suppress
      // the push; the mesh will deliver the change in milliseconds.
      const liveSet = userIdToPeerIds.get(body.recipientUserId);
      if (liveSet && liveSet.size > 0) {
        return Response.json({ skipped: 'user-online' });
      }
      // No live socket — fan out to every target subscription. Each
      // call is independent; one vendor 410'ing doesn't affect the
      // others, and the caller decides what to do with the per-target
      // statuses (typically: clear the dead subscription from the
      // device's mesh row).
      const payloadJson = JSON.stringify(body.payload);
      // Test-only escape hatch: FAIRFOX_PUSH_TEST_STUB_URL=1 makes
      // /push/send POST the wake-intent envelope (subscription +
      // unencrypted payload + recipient userId) to each target's
      // endpoint as plain JSON, instead of running web-push's
      // RFC 8291 encryption + VAPID signing path. Used by
      // `scripts/e2e-push.ts` to assert the relay's routing and
      // per-target status reporting without standing up a TLS
      // listener — web-push hard-codes `https.request` regardless
      // of endpoint scheme, so a mock vendor would otherwise need a
      // real cert. Same shape as FAIRFOX_CLAUDE_STUB in the chat
      // relay: env-gated, never set in prod, the only test-only
      // branch in this file.
      const useStub = process.env.FAIRFOX_PUSH_TEST_STUB_URL === '1';
      const results: PushTargetResult[] = await Promise.all(
        body.targets.map(async (t) => {
          if (
            !t ||
            typeof t.endpoint !== 'string' ||
            typeof t.p256dh !== 'string' ||
            typeof t.auth !== 'string'
          ) {
            return { endpoint: t?.endpoint ?? '', status: 0, ok: false };
          }
          if (useStub) {
            try {
              const stubRes = await fetch(t.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipientUserId: body.recipientUserId,
                  payload: body.payload,
                  subscription: { endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth },
                }),
              });
              return {
                endpoint: t.endpoint,
                status: stubRes.status,
                ok: stubRes.ok,
              };
            } catch {
              return { endpoint: t.endpoint, status: 0, ok: false };
            }
          }
          try {
            const result = await webpush.sendNotification(
              { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
              payloadJson,
              { TTL: 60 }
            );
            return { endpoint: t.endpoint, status: result.statusCode, ok: true };
          } catch (err) {
            const status = isWebPushError(err) ? err.statusCode : 0;
            if (status === 0) {
              console.warn(
                '[push] sendNotification failed without status:',
                err instanceof Error ? err.message : String(err)
              );
            }
            return { endpoint: t.endpoint, status, ok: false };
          }
        })
      );
      return Response.json({ results });
    }

    if (p === '/build-hash') {
      // The HTML shell bakes `appBundle.tag` into the meta tag the
      // freshness banner reads; serve the same value here so the two
      // agree once the client is on the latest bundle. Using
      // BUILD_HASH (Railway commit SHA) here made the banner loop —
      // the two signals were tracking different things and could
      // never converge.
      return Response.json(
        { hash: appBundle?.tag ?? BUILD_HASH },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Admin — inspect or refresh the currently-loaded SPA bundle.
    // The bundle itself lives as a GitHub Release asset
    // (`web-v*` tags) and this endpoint tells Railway to re-fetch
    // it without a restart.
    if (p === '/admin/web-bundle') {
      return Response.json(
        {
          tag: appBundle?.tag ?? null,
          artefacts: appBundle?.artefacts.size ?? 0,
          lastRefresh: lastBundleRefresh ? new Date(lastBundleRefresh).toISOString() : null,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (p === '/admin/refresh-web-bundle' && req.method === 'POST') {
      if (!REFRESH_TOKEN) {
        return new Response('refresh endpoint disabled — set FAIRFOX_REFRESH_TOKEN', {
          status: 503,
        });
      }
      const auth = req.headers.get('authorization') ?? '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (provided !== REFRESH_TOKEN) {
        return new Response('unauthorised', { status: 401 });
      }
      if (Date.now() - lastBundleRefresh < REFRESH_DEBOUNCE_MS) {
        return new Response('too soon — wait a few seconds before refreshing again', {
          status: 429,
        });
      }
      await refreshAppBundle();
      return Response.json(
        {
          tag: appBundle?.tag ?? null,
          artefacts: appBundle?.artefacts.size ?? 0,
          lastRefresh: new Date(lastBundleRefresh).toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
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

    // Mesh SPA asset dispatch — the bundle emits JS / CSS / source
    // maps under the `/${APP_PACKAGE}/` prefix.
    {
      const prefix = `/${APP_PACKAGE}`;
      if (p.startsWith(`${prefix}/`) && appBundle) {
        const artefactPath = p.slice(prefix.length);
        const artefact = appBundle.artefacts.get(artefactPath);
        if (!artefact) {
          return new Response('Not Found', { status: 404 });
        }
        // fflate returns Uint8Array<ArrayBufferLike>; Response/Blob
        // need Uint8Array<ArrayBuffer>. Copy into a fresh, narrower
        // buffer rather than casting.
        const body = new Uint8Array(artefact.body.byteLength);
        body.set(artefact.body);
        return new Response(body, {
          headers: { 'Content-Type': artefact.contentType },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket,
});

const dataInfo = env.DATA_DIR ? ` DATA_DIR=${env.DATA_DIR}` : '';
console.log(`fairfox listening on :${server.port}${dataInfo}`);
