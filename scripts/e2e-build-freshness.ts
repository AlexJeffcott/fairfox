/**
 * Stale-bundle detection verification.
 *
 * Proves that a tab running code from an earlier deploy notices when
 * the server's build-hash rolls to a new value and surfaces a reload
 * prompt to the user.
 *
 *   1. Starts `bun dev` with FAIRFOX_BUILD_HASH=A on port 3000.
 *   2. Opens a browser tab, injects a short poll override, navigates
 *      to the agenda sub-app.
 *   3. Confirms the banner is NOT visible while the server and the tab
 *      agree on the hash.
 *   4. Kills the first server and launches a second on the same port
 *      with FAIRFOX_BUILD_HASH=B.
 *   5. Waits for the poll interval; asserts the banner appears.
 *   6. Clicks the banner's Reload button. Verifies the new page loaded
 *      the new hash (the meta tag on the fresh document reports B).
 *
 * TARGET_URL is always localhost for this script — the test spawns
 * its own dev server to control the hash value.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Subprocess, spawn } from 'bun';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const PORT = 3000;
const AGENDA_URL = `http://localhost:${PORT}/agenda`;
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILE_DIR = resolve(ARTIFACTS, 'freshness-profile');
const REPO_ROOT = resolve(import.meta.dir, '..');

const TRACE = (label: string, msg: string): void => {
  console.log(`[${label}] ${msg}`);
};

rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });

async function startDev(hash: string): Promise<Subprocess> {
  TRACE('dev', `start with FAIRFOX_BUILD_HASH=${hash}`);
  const proc = spawn(['bun', 'packages/web/src/server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATA_DIR: './data',
      FAIRFOX_BUILD_HASH: hash,
      PORT: String(PORT),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // Wait for the server to actually accept HTTP requests — the bundle
  // build pass at startup takes a few seconds on a cold run.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) {
        return proc;
      }
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error('dev server never became healthy');
}

async function stopDev(proc: Subprocess): Promise<void> {
  proc.kill();
  await proc.exited;
  // Let the port actually release.
  await new Promise((r) => setTimeout(r, 500));
}

async function launchBrowser(): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: PROFILE_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 900 });
  page.on('pageerror', (err) => TRACE('page-error', err.message));
  // Short-circuit the client's 2-minute poll to 400ms so the test
  // finishes in seconds rather than minutes. The client reads this
  // override from window.FAIRFOX_POLL_INTERVAL_MS if it's a finite
  // number ≥ 100. evaluateOnNewDocument fires before any module body
  // evaluates, so the override is in place before BuildFreshnessBanner
  // reads it.
  await page.evaluateOnNewDocument(() => {
    (window as unknown as { FAIRFOX_POLL_INTERVAL_MS: number }).FAIRFOX_POLL_INTERVAL_MS = 400;
  });
  return { browser, page };
}

function readHashMeta(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[name="fairfox-build-hash"]');
    return meta?.getAttribute('content') ?? null;
  });
}

function bannerVisible(page: Page): Promise<boolean> {
  return page.evaluate(
    () => !!document.querySelector('button[data-action="build-freshness.reload"]')
  );
}

let dev: Subprocess | undefined;
let browserHandle: Browser | undefined;
let ok = false;

try {
  dev = await startDev('hash-a');
  const { browser, page } = await launchBrowser();
  browserHandle = browser;

  TRACE('desktop', `navigate ${AGENDA_URL}`);
  await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded' });
  const initialHash = await readHashMeta(page);
  TRACE('desktop', `initial bundle hash: ${initialHash}`);
  if (initialHash !== 'hash-a') {
    throw new Error(`expected meta hash "hash-a", got ${initialHash}`);
  }

  // Let the client tick against the same hash a few times. No banner.
  await new Promise((r) => setTimeout(r, 1500));
  if (await bannerVisible(page)) {
    throw new Error('banner showed even though server and tab hashes matched');
  }
  TRACE('desktop', 'no banner while hashes match');

  TRACE('dev', 'rolling the server to hash-b');
  await stopDev(dev);
  dev = await startDev('hash-b');

  // Wait for the client's poll to detect divergence and show the
  // banner. 400ms poll interval + network + fetch makes ~800-1200ms
  // realistic on a warm run.
  const bannerDeadline = Date.now() + 8000;
  while (Date.now() < bannerDeadline) {
    if (await bannerVisible(page)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!(await bannerVisible(page))) {
    throw new Error('banner did not appear after deploy');
  }
  TRACE('desktop', 'banner appeared after deploy');

  await page.screenshot({
    path: resolve(ARTIFACTS, 'freshness-banner.png'),
    fullPage: true,
  });

  // Click the Reload button and wait for the navigation.
  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.click('button[data-action="build-freshness.reload"]');
  await navPromise;
  const postReloadHash = await readHashMeta(page);
  TRACE('desktop', `post-reload bundle hash: ${postReloadHash}`);
  if (postReloadHash !== 'hash-b') {
    throw new Error(`expected post-reload meta hash "hash-b", got ${postReloadHash}`);
  }

  TRACE('result', 'SUCCESS — banner surfaced after deploy; reload fetched new hash');
  ok = true;
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (browserHandle) {
    await browserHandle.close();
  }
  if (dev) {
    await stopDev(dev);
  }
}

process.exit(ok ? 0 : 1);
