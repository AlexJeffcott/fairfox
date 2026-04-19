#!/usr/bin/env bun
// Build the fairfox side-panel Chrome extension into dist/.
//
// Takes a FAIRFOX_URL env override (defaults to the prod Railway URL)
// and writes a ready-to-load unpacked MV3 extension: manifest.json
// with CSP and host permissions patched for the target URL, a
// panel.html that iframes that URL, a background service worker,
// and three placeholder icons. `--zip` produces a distributable zip
// after the build for sharing or Web Store upload.

import { $ } from 'bun';

const HERE = import.meta.dir;
const DIST = `${HERE}/dist`;
const FAIRFOX_URL = process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
const IS_DEV = /^(http:\/\/(localhost|127\.0\.0\.1)|https?:\/\/\d)/.test(FAIRFOX_URL);
const ZIP = process.argv.includes('--zip');

// 1×1 transparent PNG — placeholder icon, small enough to inline. Chrome
// still needs _some_ image file at every declared size even though each
// one can be the same byte-for-byte content.
const PLACEHOLDER_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

async function clean(): Promise<void> {
  await $`rm -rf ${DIST}`;
}

async function writeManifest(): Promise<void> {
  const manifest: Record<string, unknown> = JSON.parse(
    await Bun.file(`${HERE}/manifest.json`).text()
  );
  // Host permissions let the iframe talk back through chrome.runtime if we
  // ever add a postMessage bridge; more importantly they stop Chrome's CSP
  // blocking a cross-origin framed app. The CSP override follows the same
  // shape Lingua's extension uses.
  manifest.host_permissions = [`${FAIRFOX_URL}/*`];
  manifest.content_security_policy = {
    extension_pages: `script-src 'self'; frame-src ${FAIRFOX_URL}; child-src ${FAIRFOX_URL};`,
  };
  if (IS_DEV && typeof manifest.name === 'string') {
    manifest.name = `${manifest.name} (dev)`;
  }
  await Bun.write(`${DIST}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writePanel(): Promise<void> {
  const template = await Bun.file(`${HERE}/panel.html.tpl`).text();
  await Bun.write(`${DIST}/panel.html`, template.replace('__FAIRFOX_URL__', FAIRFOX_URL));
}

async function buildBackground(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [`${HERE}/src/background.ts`],
    outdir: DIST,
    format: 'esm',
    target: 'browser',
    naming: { entry: 'background.[ext]' },
    minify: false,
    sourcemap: 'none',
  });
  if (!result.success) {
    throw new Error(`background build failed: ${result.logs.map(String).join('\n')}`);
  }
}

async function writeIcons(): Promise<void> {
  for (const size of [16, 48, 128]) {
    await Bun.write(`${DIST}/icon${size}.png`, PLACEHOLDER_PNG);
  }
}

async function zipDist(): Promise<void> {
  const manifest: Record<string, unknown> = JSON.parse(
    await Bun.file(`${HERE}/manifest.json`).text()
  );
  const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  const out = `${HERE}/fairfox-extension-v${version}.zip`;
  await $`rm -f ${out}`;
  await $`cd ${DIST} && zip -r ${out} .`;
  console.log(`zipped: ${out}`);
}

async function main(): Promise<void> {
  await clean();
  await writeManifest();
  await writePanel();
  await buildBackground();
  await writeIcons();
  console.log(`built extension into ${DIST} (FAIRFOX_URL=${FAIRFOX_URL})`);
  if (ZIP) {
    await zipDist();
  }
}

await main();
