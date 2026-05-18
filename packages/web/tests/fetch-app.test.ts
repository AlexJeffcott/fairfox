import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { contentTypeFor, OCTET_STREAM_FALLBACK } from '../src/fetch-app.ts';

// Guard against the failure mode where a new asset extension lands in
// the SPA bundle without a matching branch in contentTypeFor — the
// asset gets served as application/octet-stream, the browser rejects
// the optimised loader (WebAssembly.instantiateStreaming for .wasm,
// streaming JSON parsers, etc.), and everything still "works" so the
// rest of the suite stays green.

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const BUNDLE_CANDIDATES = [
  join(REPO_ROOT, 'dist', 'fairfox-web.zip'),
  join(REPO_ROOT, 'data', 'fairfox-web.zip'),
];
const localBundle = BUNDLE_CANDIDATES.find((p) => existsSync(p));
const haveBundle = localBundle !== undefined;

describe('contentTypeFor', () => {
  test('maps the known asset extensions to specific types', () => {
    expect(contentTypeFor('a.js')).toBe('application/javascript; charset=utf-8');
    expect(contentTypeFor('a.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('a.map')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('a.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('a.wasm')).toBe('application/wasm');
  });

  test.if(haveBundle)('every artefact in the live bundle has an explicit content-type', () => {
    if (!localBundle) {
      throw new Error('unreachable — gated by test.if(haveBundle)');
    }
    const entries = unzipSync(new Uint8Array(readFileSync(localBundle)));
    const fallbacks: string[] = [];
    for (const name of Object.keys(entries)) {
      if (name === 'manifest.json') {
        continue;
      }
      if (contentTypeFor(name) === OCTET_STREAM_FALLBACK) {
        fallbacks.push(name);
      }
    }
    expect(
      fallbacks,
      `bundle artefacts served as ${OCTET_STREAM_FALLBACK}; add a contentTypeFor branch: ${fallbacks.join(', ')}`
    ).toEqual([]);
  });
});
