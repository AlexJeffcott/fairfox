import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Smoke-test the dispatcher by running the real web server on an ephemeral
// port and issuing real HTTP requests. This exercises strip(), prefix
// ordering, and the lazy import of sub-apps end-to-end.

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const LOCAL_BUNDLE_CANDIDATES = [
  join(REPO_ROOT, 'dist', 'fairfox-web.zip'),
  join(REPO_ROOT, 'data', 'fairfox-web.zip'),
];
const localBundle = LOCAL_BUNDLE_CANDIDATES.find((p) => existsSync(p));
const haveBundle = localBundle !== undefined;

type ServerHandle = { url: string; close: () => Promise<void> };

async function startServer(): Promise<ServerHandle> {
  const dir = mkdtempSync(join(tmpdir(), 'fairfox-dispatch-test-'));
  const env: Record<string, string> = {
    ...process.env,
    DATA_DIR: dir,
    PORT: '0',
  } as Record<string, string>;
  delete env.RAILWAY_ENVIRONMENT;
  // FAIRFOX_LOCAL_BUNDLE short-circuits the GitHub-release fetch in
  // fetch-app.ts. Without it, the dispatcher tries to download a
  // web-v* release and falls back to a disk cache; on a fresh DATA_DIR
  // with no network access the SPA routes 503 even though /health
  // works. Point it at the most recent local bundle if there is one.
  if (haveBundle && localBundle) {
    env.FAIRFOX_LOCAL_BUNDLE = localBundle;
  }
  const proc = Bun.spawn(['bun', new URL('../src/server.ts', import.meta.url).pathname], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Read stdout via async iteration until the "listening on :PORT" line
  // surfaces. The earlier Promise.race-with-queued-read() pattern leaked
  // pending reads on every iteration and stalled bun:test's hook timer.
  const decoder = new TextDecoder();
  let stdoutAcc = '';
  let port = 0;
  const deadline = Date.now() + 10_000;
  for await (const chunk of proc.stdout) {
    stdoutAcc += decoder.decode(chunk);
    const m = stdoutAcc.match(/listening on :(\d+)/);
    if (m?.[1]) {
      port = Number(m[1]);
      break;
    }
    if (Date.now() > deadline) {
      break;
    }
  }

  if (port === 0) {
    proc.kill();
    throw new Error(`server did not bind within 10s\nstdout: ${stdoutAcc}`);
  }

  return {
    url: `http://localhost:${port}`,
    async close() {
      proc.kill();
      await proc.exited;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('web dispatcher', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.close();
  });

  test('/health returns {ok:true}', async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test.if(haveBundle)('/ returns the unified SPA shell', async () => {
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="app"');
    expect(html).toContain('/home/boot-');
  });

  test.if(haveBundle)('/todo-v2 returns the same SPA shell (client-side routed)', async () => {
    const res = await fetch(`${server.url}/todo-v2`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('/home/boot-');
  });

  test('unknown paths 404', async () => {
    const res = await fetch(`${server.url}/nope`);
    expect(res.status).toBe(404);
  });
});
