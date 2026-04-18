# fairfox

A Bun monorepo that gathers small web projects into a single Railway service. Each project mounts at its own subpath beneath one `Bun.serve`, shares the landing page at `/`, and owns its own SQLite database.

## Sub-apps

- **`/todo`** — project tracker (transplanted from `~/projects/todo-remote`). Raw `Bun.serve` routes + Preact/HTM/Signals frontend. Lives in `packages/todo`. Owns `data/todo.db`.
- **`/struggle`** — interactive sci-fi story (transplanted from `~/projects/the_struggle`). Elysia + vanilla JS thick client. Lives in `packages/struggle`. Owns `data/struggle.db`. **The database is the source of truth.** Seed files and `/api/reseed` referenced in old docs no longer exist; the only authoritative copy is the live DB.

## Architecture

- `packages/shared` — typed `SubApp`/`WsSubApp`/`WsData` contract, `loadEnv()`, `openDb()`. Zero runtime deps.
- `packages/web` — the single `Bun.serve`. Validates env, dispatches by URL prefix (with correct false-prefix guards), owns WebSocket upgrades on behalf of sub-apps, serves the static landing page.
- Each sub-app exports `fetch(Request): Promise<Response>` and a `mount: '/xyz'` literal. Web assigns imported namespaces to typed locals to force structural conformance at compile time.
- Todo imports are **lazy dynamic** so its module-load side effects (opening the sqlite file) don't fire until after the migration runbook has uploaded real data.

## House rules

- No `any`. No `as` casts except `as const`. No `@ts-ignore`. No `.skip()`. No `!` non-null assertions.
- All environment access goes through `@fairfox/shared/env` — no bare `process.env.X` reads.
- `biome check` and `tsc --noEmit` stay green on every commit.
- `packages/struggle` has a targeted biome override relaxing `noExplicitAny` and `useTemplate`, and loosens `noUnusedLocals`/`noUnusedParameters` in its tsconfig — these are documented concessions for transplanted creative-writing code. New fairfox code stays strict.

## Data + Railway

- Dev: `DATA_DIR=./data`, gitignored. Databases created on first boot.
- Prod: Railway volume mounted at `/data`. `loadEnv()` refuses to start if the volume is on the same device as `/` — a check that catches unmounted container filesystems.
- Production migrations use SQLite's `VACUUM INTO` against the source service, then stream the clean file into fairfox's volume while fairfox is stopped. Never raw-copy `.db` + `-wal` + `-shm` under a live writer.

## Writing-style skills

`.claude/skills/` contains four creative-writing skills (`narrative-draft`, `story-architect`, `story-critic`, `world-bible`) transplanted from the_struggle. They apply only to content work inside `packages/struggle`. **Do not use the `classic-style` skill for struggle content** — creative writing needs voice, rhythm, and the freedom to break prose rules.

## Scripts

- `bun dev` — run the web server locally (sets `DATA_DIR=./data` inline; `bun --hot` currently breaks mesh-subapp bundling so dev runs without it)
- `bun check` — biome format + lint
- `bun typecheck` — tsc across all packages
- `bun test` — run tests (once they exist)
- `bun run backup` — pull JSON backups from both sub-apps via their `/api/backup` endpoints

## Deploy

- `railway up` in the repo root. Single-stage Dockerfile. No Litestream (v1).
- Old todo-remote and the_struggle Railway services stay running for seven days after each migration as rollback insurance, then are deleted.

## Mesh sync verification

Any change that touches the pairing flow, the keyring, the mesh client,
the signalling relay, or `$meshState` must pass
`scripts/e2e-two-device-sync.ts` before being considered done. The
script launches two headless Chrome profiles, walks both through the
full pairing ceremony, types a chore on one device, and confirms it
reaches the other through real WebRTC. Screenshots land in
`scripts/artifacts/` (gitignored). Non-zero exit on any convergence
failure.

```sh
bun scripts/e2e-two-device-sync.ts                                    # prod
TARGET_URL=http://localhost:3000/agenda bun scripts/e2e-two-device-sync.ts
HEADLESS=false bun scripts/e2e-two-device-sync.ts                     # watch it
```

`bun check`, `bun typecheck`, `bun test`, and `bun test:browser` all
green means the code compiles and each unit and the protocol layer
behaves. None of them prove two devices actually sync. This script
does. The mesh-sync bug that shipped under 0.27.0 passed every tier
of automated test because the polly browser tests wired the stack by
hand and silently compensated for a gap in the `createMeshClient`
factory; the only signal that it was broken was trying to use the
feature from two Chrome profiles. The e2e script exists so that
signal is one `bun scripts/…` command away, not a day of
investigation after the next user report.

For other user-facing workflows that cross boundaries the unit suite
doesn't (any change to real-time behaviour, any new cross-sub-app
protocol, any authentication flow): build the equivalent before
declaring the work done, commit it under `scripts/`, run it from a
cold state.
