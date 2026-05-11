/**
 * Fly TURN relay verification for issue #18.
 *
 * Proves the deployed Fly stack — fairfox web (signalling) + fairfox-turn
 * (coturn) — actually carries WebRTC data between a browser and a real
 * werift CLI peer. The original symptom was `peers=0` indefinitely on
 * the CLI heartbeat after both sides emitted matching
 * `typ relay 213.x` ICE candidates: signalling and ALLOCATE worked,
 * but the relay-port UDP window declared in fly.toml with
 * `start_port`/`end_port` was not actually forwarded at Fly's edge, so
 * peers could not exchange bytes once they tried to use the returned
 * relay endpoint.
 *
 * The script asserts the live-stack invariant by holding a long-lived
 * CLI peer open and watching its heartbeat:
 *
 *   1. A fresh puppeteer Chrome profile bootstraps a user identity and
 *      emits a pair link.
 *   2. The CLI bundle (built once at the top of this script) consumes
 *      the link under an isolated HOME so no developer state is
 *      touched. The pair-return frame completes the ceremony on both
 *      sides automatically.
 *   3. `fairfox mesh serve` starts long-lived in the background under
 *      the same isolated HOME and ticks `[time] peers=N` every 15s.
 *      Test passes the moment a heartbeat reports `peers=1` — that is
 *      the original AC ("peers=0 indefinitely" → "peers=1 within 15s")
 *      expressed at the CLI's own observability layer.
 *
 * A long-lived peer avoids the WebRTC renegotiation race that
 * short-lived `agenda add`/`agenda list` invocations introduce: the
 * data channel only needs to form once, not on every operation.
 *
 *   bun scripts/e2e-fly-turn-relay.ts                # Fly stack, headless
 *   HEADLESS=false bun scripts/e2e-fly-turn-relay.ts # watch it run
 *   TARGET_URL=https://other.example/agenda bun scripts/e2e-fly-turn-relay.ts
 *
 * Per CLAUDE.md: spawn the built CLI bundle, not `bun packages/cli/src/bin.ts`.
 * Running the CLI from source loads two copies of @fairfox/polly under
 * bun's module resolution; the in-bundle code path is what real users
 * hit and the only one with a single polly instance.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { $ } from 'bun';
import puppeteer, { type Page } from 'puppeteer';
import { createIdentity } from './e2e-identity.ts';

const URL = process.env.TARGET_URL ?? 'https://fairfox.fly.dev/agenda';
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILE = resolve(ARTIFACTS, 'fly-turn-profile');
const TMP_HOME = resolve(ARTIFACTS, 'fly-turn-cli-home');
const REPO = resolve(import.meta.dir, '..');
const BUNDLE = resolve(REPO, 'packages', 'cli', 'dist', 'fairfox.js');
// mesh serve heartbeats every 15s; allow ~4 ticks before giving up.
const PEER_BUDGET_MS = 60_000;

const TRACE = (label: string, msg: string): void => {
  console.log(`[${label}] ${msg}`);
};

rmSync(PROFILE, { recursive: true, force: true });
rmSync(TMP_HOME, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(TMP_HOME, { recursive: true });

TRACE('build', `building CLI bundle (${BUNDLE})`);
await $`bun run build.ts`.cwd(resolve(REPO, 'packages', 'cli')).quiet();
const bundleStat = statSync(BUNDLE);
TRACE('build', `bundle ready (${(bundleStat.size / 1024).toFixed(0)} KB)`);

const fairfoxOrigin = URL.replace(/\/[^/]*$/, '');

async function waitForText(page: Page, text: string, timeoutMs = 20_000): Promise<void> {
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
  const deadline = Date.now() + 15_000;
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

async function cli(...args: string[]): Promise<string> {
  TRACE('cli', `run: ${args.join(' ')}`);
  const env = { ...process.env, HOME: TMP_HOME, FAIRFOX_URL: fairfoxOrigin };
  const result = await $`bun ${BUNDLE} ${args}`.env(env).quiet();
  const out = result.stdout.toString();
  const err = result.stderr.toString();
  if (out) {
    TRACE('cli', out.trim().split('\n').join(' | '));
  }
  if (err) {
    TRACE('cli-err', err.trim().split('\n').join(' | '));
  }
  return out;
}

function startDaemon(): { child: ChildProcess; readBuffer: () => string } {
  const child = spawn('bun', [BUNDLE, 'daemon', 'start', '--foreground'], {
    env: {
      ...process.env,
      HOME: TMP_HOME,
      FAIRFOX_URL: fairfoxOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    buf += text;
    for (const line of text.split('\n')) {
      if (line.trim()) {
        TRACE('daemon', line.trim());
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (line.trim()) {
        TRACE('daemon-err', line.trim());
      }
    }
  });
  return { child, readBuffer: () => buf };
}

const browser = await puppeteer.launch({
  headless: HEADLESS,
  userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 900 });
page.on('pageerror', (err) => TRACE('browser-pageerror', err.message));

let ok = false;
let daemonProc: ChildProcess | null = null;

try {
  TRACE('browser', `navigate ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await createIdentity(page, 'FlyTurnTest', (m) => TRACE('browser', m));
  await waitForText(page, "This device isn't connected to your mesh yet.");

  TRACE('browser', 'share a pairing link');
  await clickByText(page, 'Share a pairing link');
  const browserShare = await readShareUrl(page);
  TRACE('browser', `share url (${browserShare.length} chars)`);

  // The CLI's `pair` command sends a `pair-return` frame back through
  // signalling as soon as it has the return token. The browser's
  // mesh-gate hash consumer applies that frame automatically and
  // reloads itself.
  await cli('pair', browserShare);
  await waitForText(page, 'Agenda', 30_000);
  TRACE('browser', 'agenda visible — pair complete');

  // The keyring now exists on disk under TMP_HOME. Start the
  // long-lived mesh peer that will form the data channel back to the
  // browser and tick the heartbeat we're going to read.
  const { child, readBuffer } = startDaemon();
  daemonProc = child;

  TRACE('test', `waiting up to ${PEER_BUDGET_MS / 1000}s for peers>=1`);
  const deadline = Date.now() + PEER_BUDGET_MS;
  while (Date.now() < deadline) {
    if (/peers=[1-9]\d*/.test(readBuffer())) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  await page.screenshot({
    path: resolve(ARTIFACTS, 'fly-turn-relay.png'),
    fullPage: true,
  });
  if (!ok) {
    const tail = readBuffer().slice(-400);
    throw new Error(
      `daemon never reported peers>=1 within ${PEER_BUDGET_MS / 1000}s — last buffer: ${tail}`
    );
  }
  TRACE('result', 'SUCCESS — daemon reported peers>=1 against Fly');
  TRACE('result', `screenshot at ${resolve(ARTIFACTS, 'fly-turn-relay.png')}`);
} catch (err) {
  TRACE('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await page.screenshot({
      path: resolve(ARTIFACTS, 'fly-turn-relay-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort
  }
} finally {
  if (daemonProc) {
    try {
      daemonProc.kill('SIGTERM');
    } catch {
      // already dead
    }
  }
  await browser.close();
}

process.exit(ok ? 0 : 1);
