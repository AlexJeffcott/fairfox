/**
 * Two-device mesh sync verification, driven by puppeteer against a live
 * fairfox deployment. Proves the full flow end-to-end:
 *
 *   1. Two Chrome instances with separate profiles (so each has its own
 *      IndexedDB keyring and localStorage) load the agenda sub-app.
 *   2. Device A shares a pairing link.
 *   3. Device B opens the link; the mesh-gate hash consumer advances it
 *      to its own issue step and returns a reply link.
 *   4. Device A opens B's reply link to complete the asymmetric ceremony.
 *   5. Both devices reload themselves on ceremony completion; the mesh
 *      client reconstructs against the freshly-paired keyring.
 *   6. Device A creates a chore; device B sees it within a few seconds
 *      through the real WebRTC data channel.
 *
 * Screenshots of both devices with the synced chore land in
 * scripts/artifacts/. Exits non-zero on failure.
 *
 *   bun scripts/e2e-two-device-sync.ts                # prod
 *   TARGET_URL=http://localhost:3000/agenda bun scripts/e2e-two-device-sync.ts
 *   HEADLESS=false bun scripts/e2e-two-device-sync.ts # watch it run
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  MESH_SYNC_TIMEOUT_MS,
  PAIR_CEREMONY_TIMEOUT_MS,
  SHORT_TIMEOUT_MS,
  sleep,
  waitFor,
  waitForText,
} from './e2e-config.ts';

const URL = process.env.TARGET_URL ?? 'https://fairfox-production-8273.up.railway.app/agenda';
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(import.meta.dir, 'artifacts', 'profiles');

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

function readShareUrl(page: Page): Promise<string> {
  return waitFor(
    () =>
      page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
        const hit = links.find((el) => el.href.includes('#pair='));
        return hit?.href;
      }),
    { timeoutMs: SHORT_TIMEOUT_MS, description: 'share URL anchor' }
  );
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

const desktop = await launch('desktop');
const phone = await launch('phone');
let ok = false;

try {
  TRACE('desktop', `navigate ${URL}`);
  await desktop.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitForText(desktop.page, "This device isn't connected to your mesh yet.");

  TRACE('phone', `navigate ${URL}`);
  await phone.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitForText(phone.page, "This device isn't connected to your mesh yet.");

  TRACE('desktop', 'share a pairing link');
  await clickByText(desktop.page, 'Share a pairing link');
  const desktopShare = await readShareUrl(desktop.page);

  TRACE('phone', 'open desktop share link');
  await phone.page.goto(desktopShare, { waitUntil: 'domcontentloaded' });
  await waitForText(phone.page, 'Show the raw token', PAIR_CEREMONY_TIMEOUT_MS);
  const phoneShare = await readShareUrl(phone.page);

  TRACE('desktop', 'advance to scan and open phone share link');
  await clickByText(desktop.page, 'Continue — paste their link');
  await desktop.page.goto(phoneShare, { waitUntil: 'domcontentloaded' });
  await waitForText(desktop.page, 'Show the raw token', PAIR_CEREMONY_TIMEOUT_MS);

  TRACE('both', 'drain the final issue leg on both sides');
  // Each click triggers advanceAfter, which reloads the page once the
  // ceremony drains to empty. Start the nav-wait before the click so the
  // promise catches the reload rather than racing it.
  const phoneNav = phone.page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await clickByText(phone.page, "They accepted — we're done");
  await phoneNav;
  const desktopNav = desktop.page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await clickByText(desktop.page, "They accepted — we're done");
  await desktopNav;

  await waitForText(desktop.page, 'Agenda', PAIR_CEREMONY_TIMEOUT_MS);
  await waitForText(phone.page, 'Agenda', PAIR_CEREMONY_TIMEOUT_MS);
  TRACE('both', 'agenda visible on both devices');

  // Give the mesh a moment to complete its initial sync handshake over
  // the newly-opened WebRTC data channel before the test writes.
  await sleep(5000);

  // Switch both sides to the Items tab. polly's ActionInput starts in a
  // view-mode div (data-polly-action-input, role=button); a click
  // promotes it into an editable input we can type into.
  const switchToItems = async (page: Page): Promise<void> => {
    await page.click('button[data-action="agenda.tab"][data-action-id="items"]');
    await page.waitForSelector('[data-polly-action-input]', { timeout: SHORT_TIMEOUT_MS });
  };
  await switchToItems(desktop.page);
  await switchToItems(phone.page);

  const chore = `e2e-sync-${Date.now()}`;
  TRACE('desktop', `add chore "${chore}"`);
  await desktop.page.click('[data-polly-action-input][data-state="empty"]');
  await desktop.page.waitForSelector(
    'input[data-polly-action-input], textarea[data-polly-action-input]',
    { timeout: SHORT_TIMEOUT_MS }
  );
  const input = await desktop.page.$(
    'input[data-polly-action-input], textarea[data-polly-action-input]'
  );
  if (!input) {
    throw new Error('no add-chore input on desktop');
  }
  await input.type(chore);
  await input.press('Enter');

  TRACE('phone', 'wait for chore to converge');
  try {
    await waitForText(phone.page, chore, MESH_SYNC_TIMEOUT_MS);
    ok = true;
  } catch {
    ok = false;
  }

  await desktop.page.screenshot({
    path: resolve(ARTIFACTS, 'desktop.png'),
    fullPage: true,
  });
  await phone.page.screenshot({
    path: resolve(ARTIFACTS, 'phone.png'),
    fullPage: true,
  });

  if (!ok) {
    throw new Error(`chore "${chore}" did not appear on phone within 20s`);
  }
  TRACE('result', `SUCCESS — "${chore}" synced`);
  TRACE(
    'result',
    `screenshots at ${resolve(ARTIFACTS, 'desktop.png')}, ${resolve(ARTIFACTS, 'phone.png')}`
  );
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await desktop.page.screenshot({
      path: resolve(ARTIFACTS, 'desktop-error.png'),
      fullPage: true,
    });
    await phone.page.screenshot({
      path: resolve(ARTIFACTS, 'phone-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort on error screenshots
  }
} finally {
  await desktop.browser.close();
  await phone.browser.close();
}

process.exit(ok ? 0 : 1);
