FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages ./packages

RUN bun install --frozen-lockfile

# The web server streams the CLI bundle at /cli/fairfox.js, which the
# installer script wraps with a tiny shell launcher. Bundle it at image
# build so the served file always matches the server it talks to.
RUN bun run --cwd packages/cli build

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "packages/web/src/server.ts"]
