# Fairfox deploy runbook

Step-by-step for taking the meshState architecture from the `fairfox-P32-T292` branch to a running Railway deployment with paired devices. Read end to end before starting — there are steps that need human hands (scanning QR codes, confirming the live migration).

## 1. Pre-deploy checklist

Before merging the branch or deploying:

- [ ] `bun run check` passes clean (7 conformance checks)
- [ ] `bun --filter='@fairfox/ui' run typecheck` passes
- [ ] `bun test packages/ui packages/_template packages/agenda packages/todo-v2 packages/the-struggle packages/library packages/speakwell packages/family-phone-admin` passes (92 tests)
- [ ] Railway CLI is authenticated (`railway whoami`)
- [ ] `ANTHROPIC_API_KEY` is available in 1Password

## 2. Railway environment variables

Set these in the Railway project dashboard (or via `railway variables`) before deploying. The server refuses to start if `PORT` is missing; everything else has safe defaults.

| Variable | Purpose | Required |
|----------|---------|----------|
| `PORT` | Listen port (Railway sets this automatically) | yes |
| `RAILWAY_ENVIRONMENT` | Railway sets this to distinguish prod from dev | auto |
| `DATA_DIR` | Mount path for the Railway volume — needed only while legacy packages/todo and packages/struggle still run | during transition |
| `FAIRFOX_SIGNALING_URL` | Public wss:// URL of the signaling endpoint, used by clients to discover peers. Defaults to `ws://localhost:${PORT}/polly/signaling` | yes for production |
| `ANTHROPIC_API_KEY` | Claude API key for Speakwell coaching and the family-phone agent LLM proxy | when LLM routes are in use |

## 3. Deploy

```bash
cd ~/projects/fairfox
git checkout fairfox-P32-T292
railway up
```

Railway builds the Dockerfile, which installs dependencies (including the Automerge peer deps), copies the monorepo, and starts the server. First deploy takes roughly 3–5 minutes.

## 4. Post-deploy smoke test

```bash
curl https://fairfox-production-8273.up.railway.app/health
# → {"ok":true}

# Signaling WebSocket reachable
curl -i https://fairfox-production-8273.up.railway.app/polly/signaling
# → 400 Upgrade failed (expected — HTTP can't upgrade, WebSocket client would)

# Legacy sub-apps still serving
curl https://fairfox-production-8273.up.railway.app/todo/api/projects
# → JSON array of projects
```

## 5. Bundle and pair the first device

The mesh sub-apps (agenda, todo-v2, the-struggle, library, speakwell, family-phone-admin) are shipped as a bundled Preact + Automerge client served from the main server under their name. Each sub-app has an entry point at `packages/<name>/src/client/boot.tsx`.

**Current state (2026-04-16):** the build and serve step for the mesh sub-apps has not landed yet. The signaling relay is running and ready, but `/agenda`, `/todo-v2`, etc. return 404 until the bundling step is added. Track this as a follow-up task before pairing the first device.

When the bundling step is in place, the first-device flow is:

1. Open `https://fairfox-production-8273.up.railway.app/todo-v2` on a trusted device.
2. The page creates a fresh MeshKeyring on first load (stored in IndexedDB).
3. The device becomes the first peer in the mesh with no one to sync with yet. Data is local until a second device pairs in.

## 6. Run the legacy migration

With the first device paired and the todo-v2 client running, open the migration page (to be added at `/todo-v2/migrate`) which:

1. Fetches projects/tasks/captures from the legacy `/todo/api/*` endpoints
2. Writes them into the three $meshState documents (projectsState, tasksState, capturesState)
3. The CRDT sync layer propagates the data to every other paired device

**Current state (2026-04-16):** the migration exists as a server-side script at `packages/todo-v2/scripts/migrate-from-legacy.ts` but cannot reach the mesh from Node without being paired. Needs to be converted to a client-side migration page that runs from a paired browser. Track as a follow-up.

## 7. Pair a second device

1. On the first device, open `https://fairfox-production-8273.up.railway.app/family-phone-admin` and click "Issue pairing token" (flow to be wired up).
2. A QR code appears showing the encoded pairing token (base64 string containing issuer public key + document key).
3. On the second device, open `https://fairfox-production-8273.up.railway.app/family-phone-admin` and click "Pair with existing device". Scan the QR.
4. Within a few seconds, the WebRTC data channel opens between the two devices via the signaling relay. The second device pulls the full $meshState from the first.
5. Verify by adding a chore on device 1 and watching it appear on device 2.

**Current state (2026-04-16):** The keyring and pairing token primitives work (`@fairfox/shared/pairing`), but the family-phone-admin UI's pairing modal hasn't been wired up yet. Track as a follow-up.

## 8. Retire the legacy packages

After the new sub-apps have served traffic without issue for at least a week, retire the legacy packages:

1. Delete `packages/todo` and `packages/struggle`.
2. Remove legacy sub-app dispatching from `packages/web/src/server.ts` (the `getStruggle` / `getTodo` helpers and the `/todo`, `/struggle`, `/todo/ws` route handlers).
3. Delete `packages/shared/src/openDb.ts`.
4. Remove `DATA_DIR` from `packages/shared/src/env.ts`.
5. Remove the `'phone' | 'relay' | 'client'` roles from `packages/shared/src/subapp.ts` — only `'signaling'` remains.
6. Delete the legacy exclusion entries from every check script (`struggle`, `todo` drop out of `EXCLUDED_PACKAGES` in scripts/check-*.ts).
7. Remove the per-package biome overrides for struggle and todo from root `biome.json`.
8. Delete the legacy sub-app tests in `packages/web/tests/` and `packages/shared/tests/` that depend on DATA_DIR and legacy dispatch.
9. Update the landing page at `packages/web/public/index.html` to link to the new sub-apps only.

The Railway service stays the same — only the monorepo shrinks.

## Follow-up tasks before the first real deploy is useful

Status at 2026-04-16:

1. **Bundle and serve mesh sub-apps from the main server** ✓ — `packages/web/src/bundle-subapp.ts` runs `Bun.build()` at startup for each sub-app and the server serves the HTML shell + hashed JS + CSS under `/<name>/`. All six mesh sub-apps are reachable via their subpath after deploy.
2. **Wire the pairing modal in family-phone-admin** ✓ — the admin UI now has Issue-token and Scan-token flows backed by `@fairfox/shared/pairing`. Tokens are displayed as base64 for out-of-band transfer.
3. **Convert the migration script to a browser page** ✓ — `packages/todo-v2/src/client/migrate.ts` plus the "Migrate from legacy" button in the Capture view. Runs inside a paired session so writes reach the mesh.
4. **Wire pairing into every sub-app's boot flow** — new devices currently create a lonely keyring on first load and have no path to pairing unless they happen to open family-phone-admin first. A consistent "you're unpaired, scan a token to join" banner across every sub-app would fix that. Not blocking the first deploy.

The first three are done and committed on `fairfox-P32-T292`. The fourth is nice-to-have for polish but the deploy is functional without it — the family-phone-admin UI is accessible at `/family-phone-admin` from any new device and is the natural landing spot for pairing.
