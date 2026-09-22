# The production image of the Fairfox server (C7). Step 0b deploys it to Fly.
#
# `devctl image` builds it in CI, from the same tree that holds every
# development tool: each one is in package.json and in bun.lock, and the
# install below reads both. A development tool that stops the production build
# turns CI red, not the first deploy after it. Stryker stopped eal's, from June
# to 2026-08-25, and nothing saw it until a deploy (L6).
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895

WORKDIR /app

# --production: no development tool lands in the image.
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages ./packages
RUN bun install --frozen-lockfile --production

# No command yet: the server gets its entry point and its config at step 0b.
