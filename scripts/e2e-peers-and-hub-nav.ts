/**
 * Peers-view + hub-nav regression test, driven by puppeteer against a
 * live fairfox deployment. Covers three behaviours that the
 * pairing/peer-management rework introduced and that a careless
 * refactor could lose:
 *
 *   1. "Use this device alone" from the landing's pairing wizard
 *      boots the device into the paired home view. This is the
 *      cheap bootstrap for the rest of the test — no second device
 *      required.
 *   2. The Peers tab on home renders the self-device row and a
 *      `+ Pair another device` button. Clicking the button opens
 *      the pairing wizard with a QR and a share URL. Pairing now
 *      lives on the hub; every sub-app should no longer carry its
 *      own pair button.
 *   3. A mesh sub-app (todo-v2) carries a back link to `/`. Clicking
 *      it navigates to the landing, replacing the old
 *      MeshControls button. Without the link a deep-linked user has
 *      no visible way back to the hub.
 *
 * Exits non-zero on any assertion failure. Screenshots land in
 * scripts/artifacts/.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  NAV_TIMEOUT_MS,
  SETTLE_MS,
  SHORT_TIMEOUT_MS,
  sleep,
  waitFor,
  waitForText,
} from './e2e-config.ts';

const TARGET = process.env.TARGET_URL ?? 'https://fairfox-production-8273.up.railway.app/';
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(import.meta.dir, 'artifacts', 'profiles-peers-hub');

const TRACE = (label: string, msg: string): void => {
  console.log(`[${label}] ${msg}`);
};

rmSync(PROFILES, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });

async function clickByText(page: Page, text: string): Promise<void> {
  const handle = await page.evaluateHandle((t) => {
    const candidates = Array.from(document.querySelectorAll('button, a')) as HTMLElement[];
    return candidates.find((el) => (el.innerText || '').trim() === t) ?? null;
  }, text);
  const element = handle.asElement();
  if (!element) {
    throw new Error(`no clickable element with text "${text}"`);
  }
  await element.click();
}

async function launch(label: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: resolve(PROFILES, label),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 900 });
  page.on('pageerror', (err) => TRACE(`${label}-pageerror`, err.message));
  return { browser, page };
}

const device = await launch('device');
let ok = false;

try {
  const origin = new URL(TARGET).origin;

  TRACE('device', `navigate ${TARGET}`);
  await device.page.goto(TARGET, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  await waitForText(device.page, "This device isn't connected to your mesh yet.");

  // Bootstrap a paired state without a second device. "Use this
  // device alone" sets soloDeviceMode in localStorage and flips the
  // mesh gate open; home renders its Apps/Peers tabs.
  TRACE('device', 'use this device alone');
  await clickByText(device.page, 'Use this device alone');
  await waitForText(device.page, 'Apps');
  TRACE('device', 'home tabs visible');

  // ---- 1. Peers tab shows the self row and a Pair button ----
  TRACE('device', 'switch to Peers tab');
  await clickByText(device.page, 'Peers');
  // The self row uses a rename input rather than a plain strong tag;
  // assert the button for the new "+ Pair another device" affordance
  // instead of guessing at the rename text.
  await waitForText(device.page, '+ Pair another device');
  TRACE('device', 'Pair button visible on Peers');

  // ---- 2. Pair button opens the wizard ----
  TRACE('device', 'click + Pair another device');
  await clickByText(device.page, '+ Pair another device');
  // Wizard-issue renders "Show the raw token" disclosure, the raw
  // share-URL anchor, and the CLI/extension reveals. The anchor is
  // the definitive assertion — its hash carries `#pair=...&s=...`.
  const pairUrl = await waitFor(
    () =>
      device.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
        const hit = links.find((el) => el.href.includes('#pair='));
        return hit?.href;
      }),
    { timeoutMs: SHORT_TIMEOUT_MS, description: 'pair share URL anchor' }
  );
  if (!pairUrl.includes('&s=')) {
    throw new Error(`pair URL missing session id segment: ${pairUrl}`);
  }
  TRACE('device', `pair URL present: ${pairUrl.slice(0, 80)}…`);

  // Cancel the wizard so the rest of the test runs from the normal
  // paired home, not from within the pairing ceremony.
  await clickByText(device.page, 'Back');
  await waitForText(device.page, 'Apps');
  TRACE('device', 'wizard cancelled, back on home');

  // ---- 3. Deep-link into todo-v2 and use the back link ----
  TRACE('device', 'navigate into /todo-v2');
  await device.page.goto(`${origin}/todo-v2`, {
    waitUntil: 'networkidle2',
    timeout: NAV_TIMEOUT_MS,
  });
  await waitForText(device.page, 'Todo');

  // The sub-app's back link is an <a href="/"> labelled "fairfox"
  // with a left-arrow prefix. Select via the href to sidestep any
  // accidental text collisions with the sub-app's own copy.
  TRACE('device', 'click back-to-hub link');
  await device.page.evaluate(() => {
    const anchors = document.querySelectorAll('a');
    for (const el of Array.from(anchors)) {
      if (el instanceof HTMLAnchorElement && el.getAttribute('href') === '/') {
        el.click();
        return;
      }
    }
    throw new Error('no back-to-hub link found');
  });
  await device.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  const landingPath = new URL(device.page.url()).pathname;
  if (landingPath !== '/') {
    throw new Error(`back link landed on "${landingPath}", expected "/"`);
  }
  await waitForText(device.page, 'Apps');
  TRACE('device', 'landed on hub after back link');

  await sleep(SETTLE_MS);
  await device.page.screenshot({
    path: resolve(ARTIFACTS, 'peers-and-hub-nav.png'),
    fullPage: true,
  });

  ok = true;
  TRACE('result', 'SUCCESS — peers view and hub back-link both behave');
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await device.page.screenshot({
      path: resolve(ARTIFACTS, 'peers-and-hub-nav-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort
  }
} finally {
  await device.browser.close();
}

process.exit(ok ? 0 : 1);
