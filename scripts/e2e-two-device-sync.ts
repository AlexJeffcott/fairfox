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
import { createIdentity } from './e2e-identity.ts';

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

async function launch(label: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: resolve(PROFILES, label),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 900 });
  page.on('pageerror', (err) => TRACE(`${label}-pageerror`, err.message));
  page.on('console', (m) => {
    const text = m.text();
    if (/\[policy\]/.test(text)) {
      TRACE(`${label}-console`, text);
    }
  });
  return { browser, page };
}

const desktop = await launch('desktop');
const phone = await launch('phone');
let ok = false;

try {
  // Only the desktop bootstraps a user — fairfox's design is "admin
  // bootstraps first, invites everyone else." Two fresh devices each
  // self-bootstrapping creates two independent `mesh:users` docs that
  // don't cleanly merge on pair; the CRDT keeps one and drops the
  // other, leaving the replaced device without a UserEntry and with
  // no permissions. Desktop issues the phone an invite baked into the
  // share URL; the phone adopts that identity through
  // `consumePairingHash` without ever needing its own WhoAreYou.
  TRACE('desktop', `navigate ${URL}`);
  await desktop.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await createIdentity(desktop.page, 'Desktop', (m) => TRACE('desktop', m));
  await waitForText(desktop.page, "This device isn't connected to your mesh yet.");

  // One-scan ceremony with an invite: desktop shares a pair link,
  // flips the invite toggle, names the invitee. The share URL now
  // carries both the pair token and an invite blob. The phone opens
  // the URL directly — its mesh-gate hash consumer pairs, adopts the
  // invited identity, and both sides reload into the paired home
  // within ~1s through the signalling-relay pair-return.
  TRACE('desktop', 'share a pairing link');
  await clickByText(desktop.page, 'Share a pairing link');
  // Wait for the issue view (and its invite panel) to render before
  // driving the invite toggle. The invite panel is inside a <details>
  // collapsed by default — open it first so the toggle button is
  // hit-testable.
  await waitForText(desktop.page, 'Also invite a new user', SHORT_TIMEOUT_MS);
  await desktop.page.evaluate(() => {
    const details = Array.from(document.querySelectorAll('details')) as HTMLDetailsElement[];
    const hit = details.find((d) => d.innerText.includes('Also invite a new user'));
    if (hit) {
      hit.open = true;
    }
  });
  await clickByText(desktop.page, 'Invite: OFF');
  await desktop.page.waitForSelector(
    'button[data-action="invite.toggle"][data-polly-button][data-tier="primary"], ' +
      'button[data-action="invite.toggle"]',
    { timeout: SHORT_TIMEOUT_MS }
  );
  // Fill the invitee's display name so the invite blob lands in the
  // share URL (`invite.name-input` regenerates the share URL).
  const inviteInput = await desktop.page.$(
    '[data-polly-action-input][aria-label="Invitee display name"]'
  );
  if (!inviteInput) {
    throw new Error('invite name input not found');
  }
  await inviteInput.click();
  await desktop.page.waitForSelector(
    'input[data-polly-action-input][aria-label="Invitee display name"]',
    { timeout: SHORT_TIMEOUT_MS }
  );
  const inviteInputEl = await desktop.page.$(
    'input[data-polly-action-input][aria-label="Invitee display name"]'
  );
  if (!inviteInputEl) {
    throw new Error('invite name editable input not found');
  }
  await inviteInputEl.type('Phone');
  await inviteInputEl.press('Tab');
  // Poll for the share URL to update with the `invite=` fragment —
  // `invite.name-input` regenerates asynchronously.
  const desktopShare = await waitFor(
    () =>
      desktop.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
        const hit = links.find((el) => el.href.includes('#pair=') && el.href.includes('invite='));
        return hit?.href;
      }),
    { timeoutMs: SHORT_TIMEOUT_MS, description: 'share URL with invite fragment' }
  );
  TRACE('desktop', `share url with invite (${desktopShare.length} chars)`);

  // Start watching for the desktop's own reload BEFORE the phone
  // consumes the hash — the pair-return frame arrives shortly after
  // and triggers advanceAfter, which reloads the desktop without any
  // click in between.
  const desktopNav = desktop.page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: PAIR_CEREMONY_TIMEOUT_MS,
  });

  TRACE('phone', 'open desktop share link');
  const phoneNav = phone.page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: PAIR_CEREMONY_TIMEOUT_MS,
  });
  await phone.page.goto(desktopShare, { waitUntil: 'domcontentloaded' });

  // Scanner may land on the paired home without firing a distinct nav
  // event when the initial load already sits through the 1s reload
  // fence; swallow timeouts and fall through to the DOM assertion.
  await phoneNav.catch(() => undefined);
  await desktopNav.catch(() => undefined);
  TRACE('both', 'both sides reloaded — waiting for paired home');

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
  // The first ActionInput in the Items-tab form is the chore-name
  // field (`draft.name`, saveOn="blur"). Promote it to an editable
  // input, type the name, Tab out to commit the draft, then click
  // the "Add" button — the form's submit is a separate action
  // (`item.create-from-draft`), Enter on the name field only blurs.
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
  // Preact re-renders the view-mode div into an <input> on click; the
  // first character otherwise lands in the unmounting div and is
  // dropped. Focus the new input and let the commit settle before
  // typing.
  await input.focus();
  await sleep(100);
  await desktop.page.keyboard.type(chore);
  await desktop.page.keyboard.press('Tab');
  // Give the blur-commit a moment to flush the draft before firing
  // the create action — the draft.name handler runs through the same
  // event loop, so a microtask-order gap is enough.
  await sleep(200);
  await desktop.page.click('button[data-action="item.create-from-draft"]');
  await sleep(500);
  const itemCreated = await desktop.page.evaluate(
    (name) => document.body.innerText.includes(name),
    chore
  );
  TRACE('desktop', `local item visible: ${itemCreated}`);

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
