# The production image of the Fairfox server (C7). Step 0b deploys it to Fly.
#
# `devctl image` builds it in CI with every development tool installed: the
# install below is the full one, development dependencies and all. A
# development tool that stops the production build turns CI red, not the
# first deploy after it. Stryker stopped eal's, from June to 2026-08-25, and
# nothing saw it until a deploy (L6).
#
# Node 24 and Bun 1.4.2, each pinned by digest. Bun runs the install and the
# server. Node is there for the development tools that run on it: Stryker 10
# needs Node 22 or later. The `node` of the oven/bun image is Bun itself.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun

FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN node --version && bun --version

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages ./packages
RUN bun install --frozen-lockfile

# No command yet: the server gets its entry point and its config at step 0b.
