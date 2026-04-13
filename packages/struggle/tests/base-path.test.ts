import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let struggle: typeof import('../src/index.ts');

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fairfox-struggle-test-'));
  process.env.DATA_DIR = dir;
  delete process.env.RAILWAY_ENVIRONMENT;
  process.env.PORT = '0';
  struggle = await import('../src/index.ts');
  // Cleanup runs implicitly when the process exits.
  void rmSync;
});

describe('struggle /', () => {
  test('injects window.BASE_PATH = "/struggle" into served HTML', async () => {
    const res = await struggle.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script>window.BASE_PATH="/struggle";</script>');
  });

  test('no bare /api/ fetch calls remain in served HTML', async () => {
    const res = await struggle.fetch(new Request('http://localhost/'));
    const html = await res.text();
    // All five call-sites must route through window.BASE_PATH.
    expect(html).not.toMatch(/fetch\(['"]\/api\//);
  });

  test('/api/health reachable through exported fetch', async () => {
    const res = await struggle.fetch(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
