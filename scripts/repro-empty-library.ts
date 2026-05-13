/**
 * Regression artefact for fairfox#19 (pair-return never sent in real
 * Chrome when consumePairingHash hangs on $meshState.loaded).
 *
 * A puppeteer Chrome navigates to a CLI-issued share URL that
 * carries both a pair token and a recovery blob. The fresh
 * `fairfox add device` process is the only long-lived peer on the
 * deployed Fly stack. Test passes when the browser's Library tab
 * renders the refs the CLI holds locally — that requires the full
 * stack (signalling, TURN, the polly fixes from 0.49 through 0.52,
 * and the pair-return-before-recovery sequencing in
 * consumePairingHash) to be working end to end.
 *
 * Exits 0 if Refs > 0 within budget, 1 otherwise. Screenshot lands
 * at /tmp/repro-final.png on either path.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

// Start `fairfox add device` so it issues a share URL we can scan.
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
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

let ok = false;
try {
  console.log('[repro] navigate to pair URL');
  await page.goto(shareUrl, { waitUntil: 'domcontentloaded' });

  const bodyHas = (text: string): Promise<boolean> =>
    page.evaluate((t) => (document.body.innerText || '').includes(t), text);

  // Wait for either the paired home (Apps/Library nav) or, in the
  // failure mode this script was written to catch, the unpaired-gate
  // wizard. Both are valid "we got past navigation" signals.
  const homeDeadline = Date.now() + 30_000;
  while (Date.now() < homeDeadline) {
    try {
      if ((await bodyHas('Apps')) || (await bodyHas('Library'))) {
        break;
      }
    } catch {
      // Page may be navigating after pair-induced reload — keep polling.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Let the post-pair reload settle fully before any further navigation.
  await new Promise((r) => setTimeout(r, 3000));

  console.log('[repro] navigate /library');
  try {
    await page.goto('https://fairfox.fly.dev/library', { waitUntil: 'domcontentloaded' });
  } catch {
    // If the goto raced another in-flight nav, retry once after a beat.
    await new Promise((r) => setTimeout(r, 2000));
    await page.goto('https://fairfox.fly.dev/library', { waitUntil: 'domcontentloaded' });
  }

  // Each ref renders with a Delete button. Track the max across the
  // polling window — Preact remounts the Refs tab while sync messages
  // arrive and the count can flicker back to 0 even though doc state
  // is solid. Report final/max so a flaky run reads as `0/296` rather
  // than as a regression.
  const syncDeadline = Date.now() + 60_000;
  let refsMax = 0;
  let refsNow = 0;
  let stableTicks = 0;
  let lastNow = -1;
  while (Date.now() < syncDeadline) {
    refsNow = await page.evaluate(
      () => document.querySelectorAll('button[data-action="ref.delete"]').length
    );
    if (refsNow > refsMax) {
      refsMax = refsNow;
    }
    if (refsMax > 0 && !ok) {
      ok = true;
    }
    if (refsNow === lastNow && refsNow > 0) {
      stableTicks++;
      if (stableTicks >= 5) {
        break;
      }
    } else {
      stableTicks = 0;
    }
    lastNow = refsNow;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`[repro] refs rendered (final/max): ${refsNow}/${refsMax}`);

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

const paired = addBuf.includes('✓ Paired');
console.log(`[repro] add-device pair-return received: ${paired}`);

process.exit(ok ? 0 : 1);
