# fairfox

A Bun monorepo that hosts a single Preact SPA under one `Bun.serve`,
backed entirely by polly `$meshState` documents replicated between
paired devices over WebRTC. The server's primary role is the
WebSocket signalling relay; the mesh UI ships as one bundle served
from `packages/home`.

## Sub-apps

All sub-apps are routes within the unified SPA. Each owns one or
more `$meshState` documents; no server-side database is involved.

- `/` — the hub: app grid, peers, users, help.
- `/todo-v2` — projects + tasks + captures (`todo:projects`,
  `todo:tasks`, `todo:captures`).
- `/agenda` — household today view (`agenda:main`).
- `/library` — references and world bible (`library:*`).
- `/the-struggle` — interactive sci-fi story (`struggle:*`).
- `/speakwell` — spoken-skills coach (`speakwell:*`).
- `/family-phone-admin` — family directory + devices
  (`family:*`).

The legacy `/todo` (Bun.serve + SQLite) and `/struggle` (Elysia +
SQLite) sub-apps were retired on 2026-04-22; their data was
migrated into `todo:*` mesh documents beforehand. The `DATA_DIR`
env var is no longer required.

## Starting / resetting a mesh

There is **one** canonical way to create a new fairfox mesh:
`fairfox mesh init --admin "Name" [--user "Other:role"]…`. It
generates the device keyring + admin user key, writes the admin
`UserEntry` into `mesh:users`, and stashes per-user invite blobs
locally. Roles: `admin`, `member`, `guest`, `llm`. Pass `--force`
to wipe this machine's keyring + user identity + pending invites
and start fresh (affects only the local machine; other paired
devices stay on the old mesh until they wipe their own state).

Invites are onboarded with `fairfox mesh invite open <name>`
which renders a terminal QR and holds the signalling socket open
until ctrl-c. The pair-token + session id are ephemeral (born
when the QR opens, die when it closes); the admin-signed invite
blob persists across re-opens. Re-emit with `--reopen` to let an
already-paired user add another device.

Full walkthrough: `packages/cli/README.md`. The browser's
WhoAreYou wizard accepts an existing recovery blob but no longer
bootstraps a fresh admin — that path lives in the CLI.

## Architecture

- `packages/shared` — mesh primitives (pairing, keyring, policy,
  $meshState wrappers), shared action registries. Zero server
  deps.
- `packages/home` — the unified Preact SPA. One `boot.tsx`, one
  router, one action registry that merges every sub-app's
  handlers. Every mesh route serves this bundle.
- `packages/web` — the single `Bun.serve`. Serves the SPA shell
  on every mesh route, the CLI installer, the Chrome side-panel
  extension download, the WebSocket signalling relay, and a few
  small APIs (health, build-hash, CLI version).
- Each sub-app package exports `./client` (its `<App>`) and
  `./actions` (its action map + optional write-gate set). The
  unified shell imports both.

## House rules

- No `any`. No `as` casts except `as const`. No `@ts-ignore`. No `.skip()`. No `!` non-null assertions.
- All environment access goes through `@fairfox/shared/env` — no bare `process.env.X` reads.
- `biome check` and `tsc --noEmit` stay green on every commit.

## Writing-style skills

`.claude/skills/` contains four creative-writing skills
(`narrative-draft`, `story-architect`, `story-critic`,
`world-bible`). They apply to content work inside
`packages/the-struggle` (the mesh-based story app). **Do not use
the `classic-style` skill for story content** — creative writing
needs voice, rhythm, and the freedom to break prose rules.

## Scripts

- `bun dev` — run the web server locally (`bun --hot` breaks the
  mesh bundle build, so dev runs without it)
- `bun check` — biome format + lint + the house-rule checks +
  gitleaks
- `bun typecheck` — tsc across all packages
- `bun test` — run tests
- `bun pair-cli <args>` — run the CLI from source against
  localhost (no rebuild, no Railway round-trip)

## Deploy

- `railway up` in the repo root. Single-stage Dockerfile.
- CLI bundles are shipped via GitHub Releases (tag `vX.Y.Z`
  triggers the `cli-release` workflow); `fairfox update` on any
  installed CLI picks up the new bundle without a Railway deploy.

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
