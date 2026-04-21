FROM oven/bun:1 AS base
WORKDIR /app

# Cache-bust token for the CLI build. Railway's buildkit has been
# sticky about reusing the previous RUN-bundle layer even when the
# packages COPY hash should have invalidated it; bump this any time a
# deploy needs to re-run the CLI bundler.
ARG CLI_CACHE_BUST=2026-04-21T17-05

COPY package.json bun.lock ./
COPY packages ./packages

RUN bun install --frozen-lockfile

# The web server streams the CLI bundle at /cli/fairfox.js, which the
# installer script wraps with a tiny shell launcher. Bundle it at image
# build so the served file always matches the server it talks to.
RUN echo "cli cache-bust $CLI_CACHE_BUST" && bun run --cwd packages/cli build

# Pre-build the Chrome side-panel extension so the server can stream
# per-request zips with a pairing token baked in, parallel to the CLI
# installer path. The build writes an unpacked extension into
# packages/extension/dist/ which the server reads on demand.
RUN bun run --cwd packages/extension build

# Derive a deterministic build hash from the source. Railway's `up`
# deploy doesn't set RAILWAY_GIT_COMMIT_SHA and the runtime fallback
# of "dev-${pid}-${Date.now()}" shifts on every container restart —
# every restart then trips BuildFreshnessBanner even though the code
# hasn't changed. Hashing the file contents at image-build time pins
# the hash to the image, so reload prompts fire only when the deploy
# actually differs.
RUN find packages -type f \
      \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" -o -name "*.html" -o -name "*.json" \) \
      -not -path "*/node_modules/*" -not -path "*/dist/*" -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | awk '{print $1}' \
    > /app/.build-hash \
    && head -c 12 /app/.build-hash > /app/.build-hash.short \
    && mv /app/.build-hash.short /app/.build-hash

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "packages/web/src/server.ts"]
