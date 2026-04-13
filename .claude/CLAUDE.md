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

- `bun dev` — hot-reload the web server (requires `DATA_DIR`, `RAILWAY_ENVIRONMENT` in env)
- `bun check` — biome format + lint
- `bun typecheck` — tsc across all packages
- `bun test` — run tests (once they exist)
- `bun run backup` — pull JSON backups from both sub-apps via their `/api/backup` endpoints

## Deploy

- `railway up` in the repo root. Single-stage Dockerfile. No Litestream (v1).
- Old todo-remote and the_struggle Railway services stay running for seven days after each migration as rollback insurance, then are deleted.
