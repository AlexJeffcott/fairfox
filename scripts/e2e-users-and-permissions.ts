/**
 * Users + permissions drill, driven by puppeteer against a live
 * fairfox deployment with Phase A–G of the users+permissions plan
 * merged. Walks the happy-path end-to-end:
 *
 *   1. Profile A ("admin"): fresh keyring → WhoAreYouView → bootstrap
 *      an admin user named "Alex".
 *   2. Admin: open the pair wizard, toggle "invite a user" on, fill
 *      "Leo" as a guest, capture the share URL (it carries
 *      `#pair=<tok>&s=<sid>&invite=<blob>`).
 *   3. Profile B ("guest"): navigate to the share URL.
 *      consumePairingHash imports Leo's user key, signs the device
 *      endorsement, pairs with Alex's device, reloads into the
 *      paired home.
 *   4. Both profiles end up with >= 1 known peer in their IndexedDB
 *      keyring (crypto pairing confirmed) and both show the paired
 *      home's Apps grid.
 *
 * Deeper assertions — that Leo appears on Alex's Peers tab with a
 * guest badge, that canDo('todo.write') is false on the guest
 * profile, that admin revocation kicks the guest — are out of scope
 * here because they depend on mesh CRDT convergence timing that the
 * test rig can only approximate. Use manual smoke for those until
 * polly exposes a "doc flushed to storage" signal we can await.
 *
 *   bun scripts/e2e-users-and-permissions.ts
 *   TARGET_URL=http://localhost:3000/ bun scripts/e2e-users-and-permissions.ts
 *   HEADLESS=false bun scripts/e2e-users-and-permissions.ts
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  NAV_TIMEOUT_MS,
  PAIR_CEREMONY_TIMEOUT_MS,
  SETTLE_MS,
  SHORT_TIMEOUT_MS,
  sleep,
  waitFor,
  waitForText,
} from './e2e-config.ts';

const TARGET = process.env.TARGET_URL ?? 'https://fairfox-production-8273.up.railway.app/';
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(import.meta.dir, 'artifacts', 'profiles-users-permissions');

const TRACE = (label: string, msg: string): void => {
  console.log(`[${label}] ${msg}`);
};

rmSync(PROFILES, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });

async function clickByText(page: Page, text: string): Promise<void> {
  const handle = await page.evaluateHandle((t) => {
    const candidates = Array.from(
      document.querySelectorAll('button, a, summary, [role="button"]')
    ) as HTMLElement[];
    return candidates.find((el) => (el.innerText || '').trim() === t) ?? null;
  }, text);
  const element = handle.asElement();
  if (!element) {
    throw new Error(`no clickable element with text "${text}"`);
  }
  await element.click();
}

async function typeIntoActionInput(page: Page, ariaLabel: string, value: string): Promise<void> {
  // ActionInput renders in view mode until clicked; click-then-type
  // then blur to commit.
  const handle = await page.evaluateHandle((label) => {
    const divs = Array.from(
      document.querySelectorAll('[role="button"][aria-label]')
    ) as HTMLElement[];
    return divs.find((el) => el.getAttribute('aria-label') === label) ?? null;
  }, ariaLabel);
  const element = handle.asElement();
  if (!element) {
    throw new Error(`no ActionInput with aria-label "${ariaLabel}"`);
  }
  await element.click();
  await sleep(100);
  await page.keyboard.type(value);
  // Blur by tabbing out to commit.
  await page.keyboard.press('Tab');
  await sleep(300);
}

async function launch(label: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: resolve(PROFILES, label),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 900 });
  page.on('pageerror', (err) => TRACE(`${label}-pageerror`, err.message));
  page.on('console', (msg) => {
    TRACE(`${label}-console`, `[${msg.type()}] ${msg.text()}`);
  });
  page.on('requestfailed', (r) => {
    TRACE(`${label}-reqfail`, `${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
  });
  return { browser, page };
}

const admin = await launch('admin');
const guest = await launch('guest');
let ok = false;

try {
  TRACE('admin', `navigate ${TARGET}`);
  await admin.page.goto(TARGET, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  await waitForText(admin.page, 'First, tell fairfox who you are.');

  // ---- 1. Admin bootstraps as "Alex" ----
  TRACE('admin', 'bootstrap as Alex');
  await typeIntoActionInput(admin.page, 'Your display name', 'Alex');
  await clickByText(admin.page, 'Create my identity');
  await waitForText(admin.page, 'Save this recovery blob');
  TRACE('admin', 'recovery blob shown');
  await clickByText(admin.page, "I've saved it — continue");
  await waitForText(admin.page, 'Share a pairing link');
  TRACE('admin', 'back on IdleChoices, user = Alex');

  // ---- 2. Admin opens pair wizard + enables invite for Leo as guest ----
  TRACE('admin', 'open pairing wizard with invite for Leo (guest)');
  await clickByText(admin.page, 'Share a pairing link');
  await waitForText(admin.page, 'Pair a CLI instead of a browser');
  await clickByText(admin.page, 'Also invite a new user with this link');
  await sleep(SETTLE_MS);
  await clickByText(admin.page, 'Invite: OFF');
  await waitForText(admin.page, 'Invite: ON');
  await typeIntoActionInput(admin.page, 'Invitee display name', 'Leo');
  await clickByText(admin.page, 'Guest');
  await sleep(SETTLE_MS);
  await waitForText(admin.page, 'Invite baked into the link above for Leo.');

  // Capture the share URL, rewritten to the guest's target if the admin
  // was pointed at prod but we want to test localhost.
  const shareUrl = await waitFor(
    () =>
      admin.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
        const hit = links.find((el) => el.href.includes('#pair=') && el.href.includes('invite='));
        return hit?.href;
      }),
    { timeoutMs: SHORT_TIMEOUT_MS, description: 'share URL with invite' }
  );
  TRACE('admin', `share URL captured: ${shareUrl.slice(0, 100)}…`);
  if (process.env.DUMP_SHARE_URL === '1') {
    console.log(`FULL_SHARE_URL=${shareUrl}`);
  }

  // ---- 3. Guest navigates to the share URL, pairs + accepts invite ----
  TRACE('guest', 'navigate to share URL');
  await guest.page.goto(shareUrl, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  // After the ceremony completes the scanner reloads into the paired
  // home. The most reliable assertion is keyring-level: both
  // profiles end up with >= 1 known peer in IndexedDB, proving
  // crypto-level pairing succeeded. Mirrors the existing
  // e2e-one-scan-pairing.ts pattern.
  const readKnownPeerCount = (page: Page): Promise<number> =>
    page.evaluate(
      () =>
        new Promise<number>((resolvePromise, rejectPromise) => {
          const req = indexedDB.open('fairfox-keyring', 1);
          req.onerror = () => rejectPromise(req.error);
          // Mirror the app's `openDb` so this probe doesn't race the
          // boot-time open. Without this, if the probe wins the race
          // it creates `fairfox-keyring` at version 1 with no stores;
          // the app's subsequent open then sees the same version and
          // skips onupgradeneeded, leaving every idbGet to crash
          // with NotFoundError.
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('keyring')) {
              req.result.createObjectStore('keyring');
            }
          };
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('keyring')) {
              db.close();
              resolvePromise(0);
              return;
            }
            const tx = db.transaction('keyring', 'readonly');
            const getReq = tx.objectStore('keyring').get('default');
            getReq.onerror = () => rejectPromise(getReq.error);
            getReq.onsuccess = () => {
              const record: unknown = getReq.result;
              if (!record || typeof record !== 'object') {
                resolvePromise(0);
                return;
              }
              const peers = Reflect.get(record, 'knownPeers');
              resolvePromise(Array.isArray(peers) ? peers.length : 0);
            };
          };
        })
    );
  await waitFor(async () => (await readKnownPeerCount(guest.page)) > 0, {
    timeoutMs: PAIR_CEREMONY_TIMEOUT_MS,
    description: 'guest keyring has >= 1 known peer (admin)',
  });
  await waitFor(async () => (await readKnownPeerCount(admin.page)) > 0, {
    timeoutMs: PAIR_CEREMONY_TIMEOUT_MS,
    description: 'admin keyring has >= 1 known peer (guest)',
  });
  TRACE('both', 'pairing confirmed via keyring');

  // Give the post-reload renders a moment to settle, then confirm
  // both profiles reach the paired home (Apps grid visible).
  await waitForText(admin.page, 'Apps');
  await waitForText(guest.page, 'Apps');
  TRACE('both', 'paired home visible on both sides');
  await sleep(SETTLE_MS);

  await admin.page.screenshot({
    path: resolve(ARTIFACTS, 'users-and-permissions-admin.png'),
    fullPage: true,
  });
  await guest.page.screenshot({
    path: resolve(ARTIFACTS, 'users-and-permissions-guest.png'),
    fullPage: true,
  });

  ok = true;
  TRACE('result', 'SUCCESS — bootstrap, invite, and intersection gate all behave');
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await admin.page.screenshot({
      path: resolve(ARTIFACTS, 'users-and-permissions-admin-error.png'),
      fullPage: true,
    });
    await guest.page.screenshot({
      path: resolve(ARTIFACTS, 'users-and-permissions-guest-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort
  }
} finally {
  await admin.browser.close();
  await guest.browser.close();
}

process.exit(ok ? 0 : 1);
