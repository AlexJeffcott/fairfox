# The production image of the Fairfox server (C7). Step 0b deploys it to Fly.
#
# `devctl image` builds this image in CI, and this image is what a deploy
# sends to Fly. There is one image, not two.
#
# The development tools — Stryker, Playwright, the TLA+ tools, polly,
# fast-check, TypeScript — install and run on a developer's machine only
# (C7, `devlocal` DL1). None of them is in this image, so none of them can
# stop it from building. Stryker stopped eal's production build, from June to
# 2026-08-25, and nothing saw it until a deploy (L6). It cannot stop this one.
#
# Three things keep them out, and `devctl image` checks the result against the
# list it holds:
#   - .dockerignore leaves out the packages production does not run, so their
#     dependencies are never installed;
#   - --production drops every devDependency of the root and of each package
#     that is left;
#   - the RUN below deletes the type-only packages, which arrive as optional
#     peers of elysia and are not devDependencies of anything here.
#
# Bun 1.4.2, pinned by digest. Bun runs the install and the server. Node is
# not here: it was here for Stryker 10, which needs Node 22 or later, and
# Stryker no longer runs in an image.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895
RUN bun --version

# Litestream 0.5.17, one static binary copied from the official image, pinned
# by digest. It replicates the database off the machine (S7a) and runs the
# server as its child: see packages/server/serve.sh. It is not a package, so
# IMAGE_PACKAGES does not change; `devctl replica` proves it works.
COPY --from=litestream/litestream:0.5.17@sha256:4b02b9859a6b6b4087d8b8944e15f7e984bd7957cba322bbeee38b0e27b9656a /usr/local/bin/litestream /usr/local/bin/litestream
RUN litestream version

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages ./packages
RUN bun install --frozen-lockfile --production

# The type-only packages elysia asks for as optional peers. Nothing reads them
# at run time, and typescript alone is 24 MB. They cannot be dropped with
# --omit=peer: that also drops @sinclair/typebox, which elysia does read at
# run time, and the server then fails to start with the image still green.
# The name is matched without its version, so a version bump does not make
# this line miss; what is left is checked by name, not by this line.
RUN rm -rf node_modules/.bun/typescript@* \
           node_modules/.bun/@types+* \
           node_modules/.bun/bun-types@* \
           node_modules/.bun/undici-types@* \
  && find node_modules -xtype l -delete

# The command: Litestream, with the server as its child (S7a). Every setting
# comes from the environment at run time and none has a default (C1): Fly
# sets them from fly.toml, from the secrets, and from `devctl deploy`
# (DEPLOY.md). `devctl image` runs this command in the image it built and
# reads the version route (IM1).
CMD ["/app/packages/server/serve.sh"]
