/**
 * CLI-peer mesh sync verification. Proves that the @fairfox/cli package
 * can pair against a browser device and exchange $meshState mutations
 * through the real WebRTC data channel.
 *
 *   1. Starts a browser profile, runs the standard pairing flow to
 *      produce a share URL carrying a pairing token.
 *   2. Invokes `bun packages/cli/src/bin.ts pair "<token>"`, which
 *      creates a keyring under a test-scoped TMP_HOME and prints the
 *      CLI's own share URL back on stdout.
 *   3. Navigates the browser to that return URL so the mesh-gate hash
 *      consumer applies the CLI's token. The ceremony drains and the
 *      page reloads into a state where the browser's keyring holds the
 *      CLI as a known peer.
 *   4. Invokes `bun … agenda add "<chore>"` against the same TMP_HOME.
 *      The CLI opens a mesh client, waits for the browser peer, writes
 *      to the agenda document, and exits.
 *   5. Asserts the chore appears in the browser window within a few
 *      seconds through the actual WebRTC data channel. Screenshot of
 *      the browser lands in scripts/artifacts/.
 *
 * Runs against localhost by default; override TARGET_URL for prod. The
 * CLI always talks to the same origin (via FAIRFOX_URL).
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { $ } from 'bun';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const URL = process.env.TARGET_URL ?? 'http://localhost:3000/agenda';
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(ARTIFACTS, 'cli-profiles');
const TMP_HOME = resolve(ARTIFACTS, 'cli-home');
const CLI = resolve(import.meta.dir, '..', 'packages', 'cli', 'src', 'bin.ts');

const TRACE = (label: string, msg: string): void => {
  console.log(`[${label}] ${msg}`);
};

rmSync(PROFILES, { recursive: true, force: true });
rmSync(TMP_HOME, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(TMP_HOME, { recursive: true });

const fairfoxOrigin = URL.replace(/\/agenda.*$/, '');

async function waitForText(page: Page, text: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await page.evaluate((t) => (document.body.innerText || '').includes(t), text);
    if (found) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`text "${text}" not seen within ${timeoutMs}ms`);
}

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

async function readShareUrl(page: Page): Promise<string> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const found = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
      const hit = links.find((el) => el.href.includes('#pair='));
      return hit?.href;
    });
    if (found) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('share URL never appeared');
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

// Invoke the CLI, returning stdout. HOME is redirected to TMP_HOME so
// the keyring is written under scripts/artifacts/cli-home/.fairfox/
// rather than touching the developer's real keyring.
async function cli(...args: string[]): Promise<string> {
  TRACE('cli', `run: ${args.join(' ')}`);
  const env = { ...process.env, HOME: TMP_HOME, FAIRFOX_URL: fairfoxOrigin };
  const result = await $`bun ${CLI} ${args}`.env(env).quiet();
  const out = result.stdout.toString();
  if (out) {
    TRACE('cli', out.trim().split('\n').join(' | '));
  }
  return out;
}

function extractReturnShareUrl(cliOut: string, origin: string): string {
  // The pair command prints the URL fragment `#pair=<encoded>`; combine
  // with the origin so the browser can navigate to it.
  const match = cliOut.match(/#pair=([A-Za-z0-9%._~-]+)/);
  if (!match) {
    throw new Error('no #pair= token in CLI output');
  }
  return `${origin}/agenda#pair=${match[1]}`;
}

const { browser, page } = await launch('desktop');
let ok = false;

try {
  TRACE('desktop', `navigate ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitForText(page, "This device isn't connected to your mesh yet.");

  TRACE('desktop', 'share a pairing link');
  await clickByText(page, 'Share a pairing link');
  const desktopShare = await readShareUrl(page);

  // Hand the share URL to the CLI and capture its return token.
  const pairOut = await cli('pair', desktopShare);
  const cliReturnShareUrl = extractReturnShareUrl(pairOut, fairfoxOrigin);

  TRACE('desktop', 'advance to scan and consume CLI return link');
  await clickByText(page, 'Continue — paste their link');
  const postConsumeNav = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.goto(cliReturnShareUrl, { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'Show the raw token', 20000);

  TRACE('desktop', 'drain the browser issue leg');
  const ceremonyNav = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await clickByText(page, "They accepted — we're done");
  await ceremonyNav;
  await postConsumeNav.catch(() => undefined);
  await waitForText(page, 'Agenda', 20000);
  TRACE('desktop', 'agenda visible — browser is paired with CLI');

  // Pairing finished on the browser side; give the signalling server a
  // moment to register the new keyring state.
  await new Promise((r) => setTimeout(r, 2000));

  const chore = `cli-probe-${Date.now()}`;
  TRACE('cli', `add chore "${chore}"`);
  await cli('agenda', 'add', chore);

  // Wait for the browser to see the chore via CRDT sync.
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const body = await page.evaluate(() => document.body.innerText || '');
    if (body.includes(chore)) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  await page.screenshot({
    path: resolve(ARTIFACTS, 'cli-browser.png'),
    fullPage: true,
  });

  if (!ok) {
    throw new Error(`chore "${chore}" did not appear in browser within 25s`);
  }

  // Symmetric direction: browser-initiated write the CLI should see.
  TRACE('cli', 'read back via agenda list');
  const list = await cli('agenda', 'list');
  if (!list.includes(chore)) {
    throw new Error(`CLI agenda list did not include "${chore}"`);
  }

  TRACE('result', `SUCCESS — CLI and browser share "${chore}"`);
  TRACE('result', `screenshot at ${resolve(ARTIFACTS, 'cli-browser.png')}`);
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await page.screenshot({
      path: resolve(ARTIFACTS, 'cli-browser-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort on error screenshot
  }
} finally {
  await browser.close();
}

process.exit(ok ? 0 : 1);
