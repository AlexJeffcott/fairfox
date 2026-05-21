/**
 * CLI → browser mesh sync verification — the redesign-era flow.
 *
 * @covers: agenda:main, mesh:devices
 *
 * The complement of e2e-two-device-sync.ts: that script proves a
 * browser write reaches the CLI; this one proves a CLI write reaches
 * the browser, over the real WebRTC data channel.
 *
 *   1. `fairfox init` seeds a fresh mesh + admin on a disposable HOME.
 *   2. `fairfox pair open` issues a transport-only join QR; a headless
 *      Chrome opens it, adopts the admin identity encrypted over the
 *      relay's pair-ack, and reloads into the paired agenda.
 *   3. `pair open` is closed — the browser stays a live mesh peer on
 *      the relay.
 *   4. `fairfox agenda add` writes a chore from the terminal. With no
 *      `pair open` or daemon competing under the same HOME it is the
 *      device's sole mesh client, so its write races no other peerId.
 *   5. The chore reaches the browser through WebRTC; the test asserts
 *      it renders. Screenshot lands in scripts/artifacts/.
 *
 * Exits non-zero on failure.
 *
 *   bun scripts/e2e-cli-peer-sync.ts                        # prod
 *   TARGET_URL=http://localhost:3000/agenda bun scripts/e2e-cli-peer-sync.ts
 *   HEADLESS=false bun scripts/e2e-cli-peer-sync.ts         # watch it run
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildBundle,
  killAndWait,
  runCli,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';
import { SHORT_TIMEOUT_MS, waitFor } from './e2e-config.ts';
import { joinMeshFromBrowser, launchBrowser } from './e2e-pairing.ts';

const TARGET_URL = process.env.TARGET_URL ?? 'https://fairfox.fly.dev/agenda';
const ORIGIN = new URL(TARGET_URL).origin;
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(ARTIFACTS, 'cli-peer-sync-profiles');
const TEST_HOME = '/tmp/fairfox-test-cli-peer-sync';
// A freshly-killed `pair open` leaves the browser without a CLI peer;
// `agenda add` must form a brand-new WebRTC channel to it, so allow a
// generous window for that handshake plus CRDT convergence.
const SYNC_BUDGET_MS = 45_000;

rmSync(PROFILES, { recursive: true, force: true });
rmSync(TEST_HOME, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(TEST_HOME, { recursive: true });

const CLI_ENV = { FAIRFOX_URL: ORIGIN };

buildBundle();

// 1 — fresh mesh on the disposable HOME.
trace('cli', `init mesh (origin ${ORIGIN})`);
const init = await runCli(['init', 'cli-peer-sync mesh', '--admin', 'Desktop'], TEST_HOME, CLI_ENV);
if (init.status !== 0) {
  trace('cli', init.stdout.trim());
  trace('cli', init.stderr.trim());
  throw new Error('fairfox init failed');
}
trace('cli', 'mesh created, admin "Desktop"');

// 2 — `pair open` issues the join QR and holds the signalling socket.
trace('cli', 'pair open — holding a join QR');
const pairOpen = spawnCli('pair-open', ['pair', 'open'], TEST_HOME, CLI_ENV);

const browser = await launchBrowser('cli-peer', PROFILES, HEADLESS);
let ok = false;

try {
  const joinMatch = await waitForLine(
    pairOpen.stdout,
    /(https?:\/\/\S*#pair=\S+)/,
    SHORT_TIMEOUT_MS,
    'join URL from `pair open`'
  );
  const joinUrl = (joinMatch[1] ?? '').replace(/[)\].,]+$/, '');
  trace('cli', `join URL captured (${joinUrl.length} chars)`);

  // 3 — the browser joins and adopts the admin identity.
  trace('browser', 'open the join URL');
  const identityName = await joinMeshFromBrowser(browser.page, joinUrl);
  trace('browser', `identity applied: "${identityName}" — paired`);

  // Close the issuer socket; the browser remains a live mesh peer.
  trace('cli', 'closing `pair open`');
  await killAndWait(pairOpen);

  // 4 — the CLI writes a chore. `agenda add` is now the device's only
  // mesh client, so no concurrent peerId competes with its write.
  const chore = `cli-peer-${Date.now()}`;
  trace('cli', `agenda add "${chore}"`);
  const add = await runCli(['agenda', 'add', chore], TEST_HOME, CLI_ENV);
  if (add.status !== 0) {
    trace('cli', add.stdout.trim());
    trace('cli', add.stderr.trim());
    throw new Error('fairfox agenda add failed');
  }

  // 5 — wait for the chore to reach the browser over WebRTC.
  trace('test', `waiting up to ${SYNC_BUDGET_MS / 1000}s for the chore in the browser`);
  await waitFor(
    async () => (await browser.page.evaluate(() => document.body.innerText || '')).includes(chore),
    { timeoutMs: SYNC_BUDGET_MS, intervalMs: 1000, description: 'chore rendered in the browser' }
  );

  await browser.page.screenshot({
    path: resolve(ARTIFACTS, 'cli-peer-sync.png'),
    fullPage: true,
  });
  ok = true;
  trace('result', `SUCCESS — "${chore}" synced CLI → browser over WebRTC`);
  trace('result', `screenshot at ${resolve(ARTIFACTS, 'cli-peer-sync.png')}`);
} catch (err) {
  trace('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await browser.page.screenshot({
      path: resolve(ARTIFACTS, 'cli-peer-sync-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort on the error screenshot
  }
} finally {
  await killAndWait(pairOpen);
  await browser.browser.close();
}

process.exit(ok ? 0 : 1);
