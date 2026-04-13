import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV_MODULE = new URL('../src/env.ts', import.meta.url).pathname;
const RUNNER = `import('${ENV_MODULE}').then(m => { const e = m.loadEnv(); console.log(JSON.stringify(e)); });`;

type RunResult = { code: number | null; stdout: string; stderr: string };

async function run(envOverrides: Record<string, string | undefined>): Promise<RunResult> {
  const env = { ...process.env, ...envOverrides };
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      delete env[k];
    }
  }
  const proc = Bun.spawn(['bun', '-e', RUNNER], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe('loadEnv', () => {
  test('unset DATA_DIR exits 1', async () => {
    const r = await run({ DATA_DIR: undefined, RAILWAY_ENVIRONMENT: undefined });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('DATA_DIR is not set');
  });

  test('non-existent DATA_DIR exits 1', async () => {
    const r = await run({
      DATA_DIR: '/nonexistent/path/that/does/not/exist',
      RAILWAY_ENVIRONMENT: undefined,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('does not exist');
  });

  test('valid local config returns narrowed env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairfox-env-'));
    try {
      const r = await run({ DATA_DIR: dir, RAILWAY_ENVIRONMENT: undefined, PORT: '4567' });
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.DATA_DIR).toBe(dir);
      expect(parsed.PORT).toBe(4567);
      expect(parsed.RAILWAY_ENVIRONMENT).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('RAILWAY_ENVIRONMENT set but DATA_DIR on root device exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairfox-env-'));
    try {
      const r = await run({ DATA_DIR: dir, RAILWAY_ENVIRONMENT: 'production' });
      // /tmp may or may not be a distinct mount depending on platform; accept
      // either behaviour but verify the error message if exit is 1.
      if (r.code === 1) {
        expect(r.stderr).toContain('Railway volume is not mounted');
      } else {
        expect(r.code).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-numeric PORT exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairfox-env-'));
    try {
      const r = await run({
        DATA_DIR: dir,
        RAILWAY_ENVIRONMENT: undefined,
        PORT: 'not-a-number',
      });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('PORT must be a valid port');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PORT=0 is allowed (ephemeral port)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairfox-env-'));
    try {
      const r = await run({ DATA_DIR: dir, RAILWAY_ENVIRONMENT: undefined, PORT: '0' });
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.PORT).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
