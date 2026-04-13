import { loadEnv } from '@fairfox/shared/env';
import type { SubApp } from '@fairfox/shared/subapp';
import { strip } from './strip.ts';

const env = loadEnv();

type SubAppNs = { fetch(req: Request): Promise<Response>; mount: `/${string}` };

let struggleApp: SubApp | null = null;
async function getStruggle(): Promise<SubApp> {
  if (struggleApp) {
    return struggleApp;
  }
  const ns: SubAppNs = await import('@fairfox/struggle');
  struggleApp = ns;
  return struggleApp;
}

const LANDING = Bun.file(`${import.meta.dir}/../public/index.html`);

const server = Bun.serve({
  port: env.PORT,
  async fetch(req) {
    const p = new URL(req.url).pathname;

    if (p === '/health') {
      return Response.json({ ok: true });
    }
    if (p === '/' || p === '/index.html') {
      return new Response(LANDING, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (p === '/struggle' || p.startsWith('/struggle/')) {
      const s = await getStruggle();
      return s.fetch(strip(req, '/struggle'));
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`fairfox listening on :${server.port} (DATA_DIR=${env.DATA_DIR})`);
