import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Smoke-test the dispatcher by running the real web server on an ephemeral
// port and issuing real HTTP requests. This exercises strip(), prefix
// ordering, and the lazy import of sub-apps end-to-end.

type ServerHandle = { url: string; close: () => Promise<void> };

async function startServer(): Promise<ServerHandle> {
  const dir = mkdtempSync(join(tmpdir(), 'fairfox-dispatch-test-'));
  const env: Record<string, string> = {
    ...process.env,
    DATA_DIR: dir,
    PORT: '0',
  } as Record<string, string>;
  delete env.RAILWAY_ENVIRONMENT;
  const proc = Bun.spawn(['bun', new URL('../src/server.ts', import.meta.url).pathname], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const decoder = new TextDecoder();
  let stdoutAcc = '';
  let stderrAcc = '';
  let port = 0;
  const deadline = Date.now() + 10000;
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();

  while (Date.now() < deadline && port === 0) {
    const stdoutRead = stdoutReader.read();
    const stderrRead = stderrReader.read();
    const winner = await Promise.race([
      stdoutRead.then((v) => ({ which: 'out' as const, v })),
      stderrRead.then((v) => ({ which: 'err' as const, v })),
      new Promise<{ which: 'timeout' }>((r) => setTimeout(() => r({ which: 'timeout' }), 500)),
    ]);
    if (winner.which === 'out' && !winner.v.done && winner.v.value) {
      stdoutAcc += decoder.decode(winner.v.value);
    } else if (winner.which === 'err' && !winner.v.done && winner.v.value) {
      stderrAcc += decoder.decode(winner.v.value);
    }
    const m = stdoutAcc.match(/listening on :(\d+)/);
    if (m?.[1]) {
      port = Number(m[1]);
    }
  }
  stdoutReader.releaseLock();
  stderrReader.releaseLock();

  if (port === 0) {
    proc.kill();
    throw new Error(`server did not bind within 10s\nstdout: ${stdoutAcc}\nstderr: ${stderrAcc}`);
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

  test('/health returns {ok:true}', async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('/ returns landing HTML with two nav links', async () => {
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/todo"');
    expect(html).toContain('href="/struggle"');
  });

  test('/struggle reaches struggle sub-app', async () => {
    const res = await fetch(`${server.url}/struggle/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('/todo reaches todo sub-app and lists projects', async () => {
    const res = await fetch(`${server.url}/todo/api/projects`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('/todoish/y is a 404, not routed to todo (false prefix guard)', async () => {
    const res = await fetch(`${server.url}/todoish/y`);
    expect(res.status).toBe(404);
  });

  test('unknown path returns 404', async () => {
    const res = await fetch(`${server.url}/nope`);
    expect(res.status).toBe(404);
  });

  test('close server', async () => {
    await server.close();
  });
});
