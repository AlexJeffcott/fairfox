# Fairfox baseline — build order

This is the sequence that turns the decisions in [`../adr/`](../adr/) into running code. The ADRs have the reasoning; this document has the order and the deliverables.

The architecture is peer-to-peer: all sub-app state lives in `$meshState` Automerge CRDTs synced over encrypted WebRTC. The server is a stateless signaling relay, cron host, and LLM proxy. Identity is Ed25519 key pairs per device with QR-based pairing. Data resilience is inherent in the replication topology.

## Phase 1 — Shared infrastructure

The modules in `@fairfox/shared` that every sub-app depends on.

1. **Keyring management** (`packages/shared/src/keyring.ts`)
   - `createKeyring()`, `loadKeyring()`, `saveKeyring()`, `loadOrCreateKeyring()`
   - IndexedDB persistence for the MeshKeyring (identity, known peers, document keys, revoked peers)
   - Alex's devices are the default revocation authority

2. **Pairing flow** (`packages/shared/src/pairing.ts`)
   - `initiatePairing(keyring)` — create + encode pairing token, return QR-ready string
   - `completePairing(keyring, scannedToken)` — decode + apply token, persist keyring
   - `revokeDevice(keyring, peerId)` — create + apply revocation, persist
   - QR rendering via `qrcode` dependency

3. **Mesh connection factory** (`packages/shared/src/mesh.ts`)
   - `createMeshConnection(keyring)` — wire MeshSignalingClient → MeshWebRTCAdapter → MeshNetworkAdapter → Repo, call `configureMeshState(repo)`
   - Signaling URL from `FAIRFOX_SIGNALING_URL` env var
   - Returns configured Repo for `$meshState()` calls

4. **Signaling server** (`packages/shared/src/signaling.ts`)
   - Thin wrapper around Polly's `signalingServer` Elysia plugin
   - The only server-side module sub-apps need

5. **GitHub archival** (`packages/shared/src/archival.ts`)
   - Optional daily cron exporting $meshState documents to JSON
   - Commits to `AlexJeffcott/fairfox-backups`

6. **Remove dead modules**
   - Delete `openDb.ts` (SQLite gone)
   - Revise `env.ts` (remove DATA_DIR, add FAIRFOX_SIGNALING_URL)
   - Revise `subapp.ts` (SubApp shape changes — server hosts signaling, not data routes)

## Phase 2 — Sub-app template

`packages/_template` — the only blessed way to start a new sub-app.

**Client side:**
- `boot.ts` — loadOrCreateKeyring, createMeshConnection, store repo in context
- `state.ts` — typed `$meshState` document(s)
- `actions.ts` — action registry (data-action → handler, unchanged from ADR 0002)
- `App.tsx` — @fairfox/ui components, DispatchContext, data-action attributes
- `pairing.tsx` — QR display/scan modal for device onboarding

**Server side:**
- `server.ts` — Elysia with signaling plugin. No data routes, no database, no auth middleware. Static file serving for the client bundle.

**Tests:**
- Unit: action handlers produce expected $meshState mutations
- Integration: two in-memory peers sync a document change via loopback adapter

## Phase 3 — Conformance checks

Two new check scripts added to `bun run check`:

- `check-mesh-state.ts` — every non-legacy sub-app imports from `@fairfox/polly/mesh`; no SQLite; no server data routes
- `check-no-server-state.ts` — server source contains only signaling, static files, and whitelisted LLM proxy routes

Existing scripts (no-as-casting, no-inline-handlers, shared-components, no-relative-imports, layout-ban) stay with exclusion list updates as legacy packages are retired.

## Phase 4 — Server slim-down

Rewrite `packages/web/src/server.ts` to:
- Mount signaling relay
- Serve static files (landing page, sub-app client bundles)
- Health endpoint
- Daily cron for GitHub archival
- LLM proxy routes (future: Speakwell, family-phone agent)

Remove all SQLite handling, auth middleware, backup endpoints, WebSocket sub-app dispatch.

## Phase 5 — Proving ground: Agenda

First real sub-app on the meshState baseline.

- `packages/agenda/` built from `_template`
- Data model: events (time-pegged), chores (anytime), completions (who/what/when)
- All state in $meshState, no server routes
- Fairness report computed client-side from the shared CRDT
- Pairing flow tested end-to-end on two real devices
- Chosen because: small data model, natural multi-user concurrent writes, exercises CRDT merge

## Phase 6 — Legacy migration + remaining sub-apps

1. **Rebuild todo** on $meshState (largest migration)
2. **Rebuild the-struggle + library** on $meshState
3. **Greenfield sub-apps** (speakwell, family-phone PWAs) from template
4. **Retire legacy packages**, remove from conformance skip lists

## Open items

- TURN server for WebRTC NAT traversal on cellular networks
- Per-document encryption keys (single-key-per-repo in Phase 2.0; per-document is a Polly follow-up)
- Automerge document compaction for long-lived documents
- LLM proxy auth (the server needs to know which family member is making an LLM request; device key signing on the request is the natural shape)
