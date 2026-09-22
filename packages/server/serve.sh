#!/bin/sh
# The command of the production image (its CMD). Litestream replicates the
# database to the replica and runs the server as its child, so the two are one
# process tree (S7a): when the server exits, Litestream exits, and Fly restarts
# the machine; when Fly stops the machine, Litestream passes SIGTERM on to the
# server and waits for it.
#
# Litestream reads the same database path as the server (C1), and the replica
# URL. Neither has a default: a missing one stops here, naming the setting.
# The port and the commit are read by the server itself, which does not start
# without them. Credentials for an S3 replica are Litestream's own variables,
# LITESTREAM_ACCESS_KEY_ID and LITESTREAM_SECRET_ACCESS_KEY: see DEPLOY.md.
#
# A volume that holds no database is restored from the replica before the
# server starts (`tigris` TG2). With no replica either, the first start of a
# new app, Litestream makes an empty database and carries on.
set -eu
: "${FAIRFOX_DATABASE_PATH:?The setting FAIRFOX_DATABASE_PATH is not set. It has no default.}"
: "${FAIRFOX_REPLICA_URL:?The setting FAIRFOX_REPLICA_URL is not set. It has no default.}"
exec litestream replicate -restore-if-db-not-exists -exec "bun packages/server/src/main.ts" "$FAIRFOX_DATABASE_PATH" "$FAIRFOX_REPLICA_URL"
