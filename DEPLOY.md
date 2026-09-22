# Deploying the server

The server runs in the Fly app `fairfox` (C10), in one machine in `ams`, with one volume at `/data`. `devctl deploy` deploys the commit at HEAD and no other (M6); `devctl rollback` goes back one release (C6). Both write a record under `.devctl/deploys/` (M4). Neither runs in CI.

## Every setting the code reads (C3)

The check `env-list` compares this table with the code: the `SETTINGS` table in `packages/server/src/config.ts`, every `process.env` in `packages/server/`, and every `$FAIRFOX_*` in `packages/server/serve.sh`. A variable on one side and not the other fails it. None has a default (C1).

| Variable | Read by | Set where |
|---|---|---|
| `FAIRFOX_COMMIT` | `packages/server/src/main.ts`, through `config.ts`: the version route answers it (C5) | `devctl deploy`, as `--env FAIRFOX_COMMIT=<HEAD>` on each deploy; `devctl rollback` sets the commit of the release it goes back to |
| `FAIRFOX_DATABASE_PATH` | `packages/server/src/main.ts` and `status.ts`, through `config.ts`; `packages/server/serve.sh`, which hands it to Litestream (C1) | `fly.toml`, `[env]`: `/data/fairfox.db`, on the volume |
| `FAIRFOX_PORT` | `packages/server/src/main.ts`, through `config.ts` | `fly.toml`, `[env]`: `3000`, the same number as `internal_port` |
| `FAIRFOX_REPLICA_URL` | `packages/server/serve.sh`, which hands it to Litestream; `packages/server/src/status.ts`, to read the replica's age (S7a) | a secret: `fly secrets set FAIRFOX_REPLICA_URL=...`. It names the bucket and the path in it |

## Settings Litestream reads

These are not read by any code in this repository, so `env-list` does not compare them. Litestream needs them when the replica is an S3-style bucket; a `file://` replica, as in `devctl replica`, needs none.

| Variable | Set where |
|---|---|
| `LITESTREAM_ACCESS_KEY_ID` | a secret |
| `LITESTREAM_SECRET_ACCESS_KEY` | a secret |

## What a deploy does

1. Refuses when the working tree is not clean, and when `.devctl/ci/<HEAD>.json` holds no green run of every registered check (M6).
2. Tags the image `devctl image` built, `fairfox:<HEAD>`, as `registry.fly.io/fairfox:<HEAD>`, and pushes it: the image CI checked is the image that runs (C7).
3. Runs `fly deploy --image registry.fly.io/fairfox:<HEAD> --env FAIRFOX_COMMIT=<HEAD>` (C8).
4. Reads `https://fairfox.fly.dev/version` and fails on a commit other than HEAD (C5).
5. Writes `.devctl/deploys/<timestamp>.json`: the release before and after, the commit, the version answered (M4). On the first deploy it also writes `deploy/first-release.json`, which is committed: the first release of the new server.

## What a rollback does

1. Lists the releases with `fly releases --json` and picks the one before the current release.
2. Refuses a release older than `deploy/first-release.json`: the app still holds the old app's releases (C6).
3. Reads the commit from the release's image tag, `registry.fly.io/fairfox:<commit>`, and runs `fly deploy --image <that image> --env FAIRFOX_COMMIT=<commit>`. flyctl 0.4.102 has no `fly releases rollback`; a deploy of the earlier image is the rollback.
4. Reads `/version` and fails on another commit, then writes the deploy record.

## Reading the status on the server (C5)

    fly ssh console -a fairfox -C "bun packages/server/src/status.ts"

One JSON line: the latest migration, the database path, the marker and the replica's age in seconds. Exit 1 when the replica holds nothing or is older than one hour (S7a).
