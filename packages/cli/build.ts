#!/usr/bin/env bun
// Bundler for the fairfox CLI.
//
// `bun build --target=bun` on its own leaves the Automerge WASM as a
// separate asset (it emits `automerge-<hash>.wasm` alongside the
// entry script). That is awkward for "paste install.sh into a
// terminal and the CLI is on disk" distribution — one file should
// be enough. This script swaps every `@automerge/automerge` import
// for the `fullfat_base64` entry point, which inlines the WASM as a
// base64 string and self-initialises. Result: a single
// `dist/fairfox.js` with no external assets.

import { resolve } from 'node:path';
import type { BunPlugin } from 'bun';

const automergeBase64Path = resolve(
  process.cwd(),
  'node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js'
);

const automergeBase64Plugin: BunPlugin = {
  name: 'automerge-base64',
  setup(build) {
    build.onResolve({ filter: /^@automerge\/automerge(\/slim)?$/ }, () => {
      return { path: automergeBase64Path };
    });
  },
};

// Bake the release tag into the bundle so the update command can
// compare it to the latest GitHub release. CI sets
// FAIRFOX_CLI_VERSION from the git tag; local builds fall back to
// "dev".
const version = process.env.FAIRFOX_CLI_VERSION ?? 'dev';

const result = await Bun.build({
  entrypoints: ['src/bin.ts'],
  target: 'bun',
  format: 'esm',
  minify: true,
  outdir: 'dist',
  naming: { entry: 'fairfox.js' },
  define: {
    __FAIRFOX_CLI_VERSION__: JSON.stringify(version),
  },
  plugins: [automergeBase64Plugin],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const entry = result.outputs.find((o) => o.path.endsWith('fairfox.js'));
if (!entry) {
  console.error('build produced no fairfox.js');
  process.exit(1);
}
const size = (entry.size / 1024).toFixed(0);
console.log(`fairfox.js — ${size} KB`);
