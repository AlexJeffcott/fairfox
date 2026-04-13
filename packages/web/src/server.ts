import { loadEnv } from '@fairfox/shared/env';

const env = loadEnv();

const LANDING = Bun.file(`${import.meta.dir}/../public/index.html`);

const server = Bun.serve({
  port: env.PORT,
  fetch(req) {
    const p = new URL(req.url).pathname;

    if (p === '/health') {
      return Response.json({ ok: true });
    }
    if (p === '/' || p === '/index.html') {
      return new Response(LANDING, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`fairfox listening on :${server.port} (DATA_DIR=${env.DATA_DIR})`);
