#!/usr/bin/env bun
// Build the fairfox SPA into a zip that GitHub Releases can host.
// Mirrors the Bun.build call in packages/web/src/bundle-app.ts but
// writes the artefacts to disk + a manifest, then zips the lot.
//
// Used by .github/workflows/web-release.yml on `web-v*` tag pushes.
// Railway's server fetches the produced asset at startup (and on
// demand via /admin/refresh-web-bundle) instead of building the
// bundle itself — UI changes ship with `git tag web-v<X>.<Y>.<Z>`
// without a Railway deploy.
//
// Output: dist/fairfox-web.zip with
//   manifest.json   — { entryJs, entryCss, files: string[] }
//   <hash>.js       — SPA entry
//   <hash>.css      — optional CSS collected from CSS modules
//   <hash>.js.map   — sourcemap

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';

const REPO_ROOT = resolve(import.meta.dir, '..');
const ENTRY = resolve(REPO_ROOT, 'packages/home/src/client/boot.tsx');
const OUT_DIR = resolve(REPO_ROOT, 'dist');
const OUT_ZIP = resolve(OUT_DIR, 'fairfox-web.zip');

const result = await Bun.build({
  entrypoints: [ENTRY],
  target: 'browser',
  format: 'esm',
  splitting: false,
  minify: false,
  sourcemap: 'linked',
  naming: { entry: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]' },
});
if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const files: Record<string, Uint8Array> = {};
let entryJs = '';
let entryCss = '';
for (const output of result.outputs) {
  const name = output.path.replace(/^\.\//, '').replace(/^\//, '');
  const bytes = new Uint8Array(await output.arrayBuffer());
  files[name] = bytes;
  if (output.kind === 'entry-point') {
    entryJs = `/${name}`;
  }
  if (output.kind === 'asset' && name.endsWith('.css')) {
    entryCss = `/${name}`;
  }
}

const manifest = {
  entryJs,
  entryCss: entryCss || null,
  files: Object.keys(files).sort(),
  builtAt: new Date().toISOString(),
};
files['manifest.json'] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

mkdirSync(OUT_DIR, { recursive: true });
const zipped = zipSync(files, { level: 6 });
await Bun.write(OUT_ZIP, zipped);

const sizeKb = (zipped.length / 1024).toFixed(1);
console.log(`fairfox-web.zip — ${sizeKb} KB (${Object.keys(files).length} files)`);
console.log(`  entry JS:  ${entryJs}`);
console.log(`  entry CSS: ${entryCss || '(none)'}`);
