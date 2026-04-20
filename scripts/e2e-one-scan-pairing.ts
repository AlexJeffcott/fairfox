/**
 * One-scan pairing verification, driven by puppeteer against a live
 * fairfox deployment. Proves the signalling-relayed pair-return flow
 * end-to-end:
 *
 *   1. Two Chrome instances with separate profiles (so each has its
 *      own IndexedDB keyring) load the fairfox landing page.
 *   2. Device A ("issuer") clicks "Share a pairing link"; the wizard
 *      generates a QR plus a share URL with `#pair=<token>&s=<sessionId>`.
 *   3. Device B ("scanner") opens the share URL, which triggers
 *      `consumePairingHash` — it accepts A's token, builds its own
 *      reciprocal token, sends `pair-return` through the signalling
 *      socket, and reloads into the paired home view.
 *   4. The server's relay hands the return frame to A's waiting
 *      socket; A's wizard auto-applies the token, drains both steps,
 *      and reloads — *without the issuer ever touching the wizard
 *      after the initial share click*.
 *   5. Both devices show the Apps grid on the home sub-app, which
 *      is only visible to paired devices.
 *
 * The assertion that separates this from the existing
 * e2e-two-device-sync script is the "no clicks on the issuer after
 * the initial share" constraint: if the one-scan flow regresses,
 * the issuer's wizard will still be in wizard-issue when the script
 * gives up, and the test fails with a "issuer never reloaded"
 * message. Screenshots land in scripts/artifacts/. Exits non-zero
 * on failure.
 *
 *   bun scripts/e2e-one-scan-pairing.ts                 # prod
 *   TARGET_URL=http://localhost:3000/ bun scripts/e2e-one-scan-pairing.ts
 *   HEADLESS=false bun scripts/e2e-one-scan-pairing.ts  # watch it run
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  hasKeyInObject,
  MESH_SYNC_TIMEOUT_MS,
  PAIR_CEREMONY_TIMEOUT_MS,
  SETTLE_MS,
  SHORT_TIMEOUT_MS,
  sleep,
  waitFor,
  waitForText,
} from './e2e-config.ts';

const URL = process.env.TARGET_URL ?? 'https://fairfox-production-8273.up.railway.app/';
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(import.meta.dir, 'artifacts', 'profiles-one-scan');

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

const issuer = await launch('issuer');
const scanner = await launch('scanner');
let ok = false;

try {
  TRACE('issuer', `navigate ${URL}`);
  await issuer.page.goto(URL, { waitUntil: 'networkidle2' });
  await waitForText(issuer.page, "This device isn't connected to your mesh yet.");

  TRACE('scanner', `navigate ${URL}`);
  await scanner.page.goto(URL, { waitUntil: 'networkidle2' });
  await waitForText(scanner.page, "This device isn't connected to your mesh yet.");

  // Give both signalling sockets a moment to establish before the
  // issuer sends its pair-issue frame.
  await new Promise((r) => setTimeout(r, 500));

  TRACE('issuer', 'share a pairing link');
  await clickByText(issuer.page, 'Share a pairing link');
  const shareUrl = await readShareUrl(issuer.page);
  if (!shareUrl.includes('&s=')) {
    throw new Error(`share URL missing session id segment: ${shareUrl}`);
  }
  TRACE('issuer', `share URL generated: ${shareUrl.slice(0, 80)}…`);

  // Start watching for a navigation on the issuer BEFORE the scanner
  // consumes the URL — the one-scan flow reloads the issuer through
  // its own pair-return listener, with no click in between.
  const issuerNav = issuer.page.waitForNavigation({
    waitUntil: 'networkidle2',
    timeout: PAIR_CEREMONY_TIMEOUT_MS,
  });

  TRACE('scanner', 'open share URL');
  const scannerNav = scanner.page.waitForNavigation({
    waitUntil: 'networkidle2',
    timeout: PAIR_CEREMONY_TIMEOUT_MS,
  });
  await scanner.page.goto(shareUrl, { waitUntil: 'networkidle2' });

  // The scanner reloads into home right after applyScannedToken +
  // sendPairReturnForSession. The issuer reloads a moment later once
  // its custom-frame listener applies the return token.
  await scannerNav.catch(() => {
    // Scanner may land on the paired home without firing a
    // navigation event if the initial load already is the post-reload
    // state; fall through to the keyring assertion below.
  });
  TRACE('scanner', 'reload observed');

  await issuerNav;
  TRACE('issuer', 'reload observed — one-scan flow completed');

  // The definitive assertion is against IndexedDB, not the DOM: each
  // keyring should now carry a known peer entry for the other device.
  // The paired home render is a consequence of that; asserting on it
  // directly would trip on transient layout changes that don't reflect
  // the mesh state. The browser-side block returns the raw record as
  // JSON; the Node-side caller narrows via `propArray` so the unknown
  // shape is handled in one place across every e2e script.
  const readKeyringRecord = (page: Page): Promise<unknown> =>
    page.evaluate(
      () =>
        new Promise<unknown>((resolve, reject) => {
          const req = indexedDB.open('fairfox-keyring', 1);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('keyring', 'readonly');
            const getReq = tx.objectStore('keyring').get('default');
            getReq.onerror = () => reject(getReq.error);
            getReq.onsuccess = () => resolve(getReq.result);
          };
        })
    );

  const readKnownPeerCount = async (page: Page): Promise<number> => {
    const record = await readKeyringRecord(page);
    if (!hasKeyInObject(record, 'knownPeers')) {
      return 0;
    }
    const peers = record.knownPeers;
    return Array.isArray(peers) ? peers.length : 0;
  };

  const issuerPaired = await waitFor(async () => (await readKnownPeerCount(issuer.page)) > 0, {
    timeoutMs: MESH_SYNC_TIMEOUT_MS,
    description: 'issuer keyring has >= 1 known peer',
  });
  const scannerPaired = await waitFor(async () => (await readKnownPeerCount(scanner.page)) > 0, {
    timeoutMs: MESH_SYNC_TIMEOUT_MS,
    description: 'scanner keyring has >= 1 known peer',
  });
  TRACE('both', `paired — issuer=${issuerPaired}, scanner=${scannerPaired}`);
  // Let the post-pairing reload settle before taking screenshots.
  await sleep(SETTLE_MS);
  await waitForText(issuer.page, 'fairfox');
  await waitForText(scanner.page, 'fairfox');

  await issuer.page.screenshot({
    path: resolve(ARTIFACTS, 'one-scan-issuer.png'),
    fullPage: true,
  });
  await scanner.page.screenshot({
    path: resolve(ARTIFACTS, 'one-scan-scanner.png'),
    fullPage: true,
  });

  ok = true;
  TRACE('result', 'SUCCESS — one-scan pairing completed without issuer interaction');
  TRACE(
    'result',
    `screenshots at ${resolve(ARTIFACTS, 'one-scan-issuer.png')}, ${resolve(ARTIFACTS, 'one-scan-scanner.png')}`
  );
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await issuer.page.screenshot({
      path: resolve(ARTIFACTS, 'one-scan-issuer-error.png'),
      fullPage: true,
    });
    await scanner.page.screenshot({
      path: resolve(ARTIFACTS, 'one-scan-scanner-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort
  }
} finally {
  await issuer.browser.close();
  await scanner.browser.close();
}

process.exit(ok ? 0 : 1);
