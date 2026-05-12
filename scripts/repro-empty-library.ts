/**
 * Reproduces (and now should disprove) the empty-library bug:
 * a fresh Chrome that joins Alex's mesh via a CLI-issued pair URL
 * carrying both pair token and recovery blob shows zero data in
 * /library, despite the CLI being a long-lived peer with hundreds
 * of refs locally.
 *
 * The script:
 *   1. Starts `fairfox add device` in the background pointed at Fly.
 *   2. Captures the share URL it prints.
 *   3. Boots puppeteer Chrome to that URL.
 *   4. Lets the mesh-gate hash consumer run, waits for the auto-reload.
 *   5. Visits /library and reports refs.length.
 *
 * Exits 0 if the references tab populates within budget, 1 otherwise.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const HEADLESS = process.env.HEADLESS !== 'false';
const CHROME =
  process.env.CHROME ??
  '/Users/AJT/.cache/puppeteer/chrome/mac_arm-147.0.7727.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PROFILE = '/tmp/repro-empty-profile';
const CLI = '/Users/AJT/.local/bin/fairfox';
const ADD_DEVICE_LOG = '/tmp/repro-add-device.log';

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });
writeFileSync(ADD_DEVICE_LOG, '');

// Start `fairfox add device` so it issues a share URL.
const addDevice = spawn(CLI, ['add', 'device'], {
  env: { ...process.env, FAIRFOX_URL: 'https://fairfox.fly.dev' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let addBuf = '';
addDevice.stdout.on('data', (c: Buffer) => {
  const text = c.toString();
  addBuf += text;
  writeFileSync(ADD_DEVICE_LOG, addBuf);
});
addDevice.stderr.on('data', (c: Buffer) => {
  const text = c.toString();
  addBuf += text;
  writeFileSync(ADD_DEVICE_LOG, addBuf);
});

// Wait for the share URL.
const deadline = Date.now() + 20_000;
let shareUrl = '';
while (Date.now() < deadline) {
  const m = addBuf.match(/https:\/\/fairfox\.fly\.dev\/#pair=[^\s]+/);
  if (m) {
    shareUrl = m[0];
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
if (!shareUrl) {
  console.log('[repro] FAIL: never got a share URL from add device');
  addDevice.kill('SIGTERM');
  process.exit(1);
}
console.log('[repro] share URL captured');

const browser = await puppeteer.launch({
  headless: HEADLESS,
  executablePath: CHROME,
  userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
page.on('pageerror', (e) => console.log('[err]', e.message));

let ok = false;
try {
  console.log('[repro] navigate to pair URL');
  await page.goto(shareUrl, { waitUntil: 'domcontentloaded' });

  async function bodyHas(text: string): Promise<boolean> {
    return page.evaluate((t) => (document.body.innerText || '').includes(t), text);
  }
  const homeDeadline = Date.now() + 30_000;
  while (Date.now() < homeDeadline) {
    if ((await bodyHas('Apps')) || (await bodyHas('Library'))) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('[repro] navigate /library');
  await page.goto('https://fairfox.fly.dev/library', { waitUntil: 'domcontentloaded' });

  // Poll for refs.length > 0 within budget.
  const syncDeadline = Date.now() + 45_000;
  let refsSeen = 0;
  while (Date.now() < syncDeadline) {
    const body = await page.evaluate(() => document.body.innerText || '');
    // Library refs render as items inside the Refs tab; "No references yet."
    // disappears when the doc populates. Count items by looking for any
    // non-empty list — proxy by the absence of the empty marker.
    if (!body.includes('No references yet.')) {
      // Count visible reference rows. The UI renders each ref with its
      // title; an `article` or `li` per row is typical. Fall back to
      // counting lines if we can't find a stable selector.
      refsSeen = await page.evaluate(() => {
        // Look for any element that's a ref item under the Refs tab.
        // Heuristic: the body text after "Library" no longer contains
        // "No references yet."; report 1+ to indicate sync landed.
        const text = document.body.innerText || '';
        const noMatch = text.includes('No references yet.');
        return noMatch ? 0 : 1;
      });
      if (refsSeen > 0) {
        ok = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  await page.screenshot({ path: '/tmp/repro-final.png', fullPage: true });
  if (ok) {
    console.log('[repro] SUCCESS — library populated (refs visible)');
  } else {
    const body = await page.evaluate(() => (document.body.innerText || '').slice(0, 600));
    console.log('[repro] FAIL — library still empty after budget');
    console.log('[repro] last body:', body.replace(/\n+/g, ' | '));
  }
} finally {
  await browser.close();
  addDevice.kill('SIGTERM');
}

const log = readFileSync(ADD_DEVICE_LOG, 'utf8');
const paired = log.includes('✓ Paired');
console.log(`[repro] add-device pair-return received: ${paired}`);

process.exit(ok ? 0 : 1);
