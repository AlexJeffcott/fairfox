/**
 * Invite-path pairing verification — the redesign-era flow.
 *
 * @covers: mesh:users, mesh:devices
 *
 * e2e-two-device-sync.ts covers `fairfox pair open` with no flag —
 * adding another of the admin's *own* devices, which adopts the
 * admin's recovery blob. This script covers the other half of the
 * redesign: `fairfox pair open --user "Name:role"`, which invites a
 * brand-new person. That device adopts an admin-signed *invite* blob,
 * a distinct hand-off from the recovery-blob path.
 *
 *   1. `fairfox init` seeds a fresh mesh + admin on a disposable HOME.
 *   2. `fairfox pair open --user "Scanner:member"` mints the invite
 *      and issues a transport-only join QR.
 *   3. A headless Chrome opens the join URL, decrypts the invite blob
 *      handed over the relay's pair-ack, and reloads paired — adopting
 *      the *invitee's* identity, not the admin's.
 *   4. The test asserts the browser adopted the "Scanner" identity and
 *      that `fairfox users` now reports Scanner as a member alongside
 *      the admin — proving the invite reached mesh:users.
 *
 * One scan of the QR completes the ceremony with no further action on
 * the issuer; since the redesign the issuer is a CLI, so that is
 * structurally guaranteed rather than asserted. Screenshot lands in
 * scripts/artifacts/. Exits non-zero on failure.
 *
 *   bun scripts/e2e-one-scan-pairing.ts                       # prod
 *   TARGET_URL=http://localhost:3000/agenda bun scripts/e2e-one-scan-pairing.ts
 *   HEADLESS=false bun scripts/e2e-one-scan-pairing.ts        # watch it run
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildBundle,
  interruptAndWait,
  runCli,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';
import { SHORT_TIMEOUT_MS } from './e2e-config.ts';
import { joinMeshFromBrowser, launchBrowser } from './e2e-pairing.ts';

const TARGET_URL = process.env.TARGET_URL ?? 'https://fairfox.fly.dev/agenda';
const ORIGIN = new URL(TARGET_URL).origin;
const HEADLESS = process.env.HEADLESS !== 'false';
const ARTIFACTS = resolve(import.meta.dir, 'artifacts');
const PROFILES = resolve(ARTIFACTS, 'one-scan-profiles');
const TEST_HOME = '/tmp/fairfox-test-one-scan';
const INVITEE = 'Scanner';

rmSync(PROFILES, { recursive: true, force: true });
rmSync(TEST_HOME, { recursive: true, force: true });
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(TEST_HOME, { recursive: true });

const CLI_ENV = { FAIRFOX_URL: ORIGIN };

buildBundle();

// 1 — fresh mesh on the disposable HOME.
trace('cli', `init mesh (origin ${ORIGIN})`);
const init = await runCli(['init', 'one-scan mesh', '--admin', 'Admin'], TEST_HOME, CLI_ENV);
if (init.status !== 0) {
  trace('cli', init.stdout.trim());
  trace('cli', init.stderr.trim());
  throw new Error('fairfox init failed');
}
trace('cli', 'mesh created, admin "Admin"');

// 2 — `pair open --user` mints the invite and issues the join QR.
trace('cli', `pair open --user "${INVITEE}:member" — holding a join QR`);
const pairOpen = spawnCli(
  'pair-open',
  ['pair', 'open', '--user', `${INVITEE}:member`],
  TEST_HOME,
  CLI_ENV
);

const browser = await launchBrowser('scanner', PROFILES, HEADLESS);
let ok = false;

try {
  const joinMatch = await waitForLine(
    pairOpen.stdout,
    /(https?:\/\/\S*#pair=\S+)/,
    SHORT_TIMEOUT_MS,
    'join URL from `pair open --user`'
  );
  const joinUrl = (joinMatch[1] ?? '').replace(/[)\].,]+$/, '');
  trace('cli', `join URL captured (${joinUrl.length} chars)`);

  // 3 — the browser joins as the invitee, not as the admin.
  trace('browser', 'open the join URL');
  const identityName = await joinMeshFromBrowser(browser.page, joinUrl);
  trace('browser', `identity applied: "${identityName}"`);
  if (identityName !== INVITEE) {
    throw new Error(`browser adopted "${identityName}", expected the invitee "${INVITEE}"`);
  }

  // SIGINT so `pair open` flushes the synced mesh:users into HOME's
  // storage before the read-only `users` process opens it.
  trace('cli', 'closing `pair open`');
  await interruptAndWait(pairOpen);

  // 4 — the invitee must now be a member in mesh:users.
  const users = await runCli(['users'], TEST_HOME, CLI_ENV);
  trace('cli', `users:\n${users.stdout.trim()}`);
  if (!users.stdout.includes('Admin')) {
    throw new Error('mesh:users is missing the admin user');
  }
  if (!users.stdout.includes(INVITEE)) {
    throw new Error(`mesh:users is missing the invited user "${INVITEE}"`);
  }

  await browser.page.screenshot({
    path: resolve(ARTIFACTS, 'one-scan.png'),
    fullPage: true,
  });
  ok = true;
  trace('result', `SUCCESS — invitee "${INVITEE}" paired and joined mesh:users`);
  trace('result', `screenshot at ${resolve(ARTIFACTS, 'one-scan.png')}`);
} catch (err) {
  trace('result', `FAILURE — ${err instanceof Error ? err.message : String(err)}`);
  try {
    await browser.page.screenshot({
      path: resolve(ARTIFACTS, 'one-scan-error.png'),
      fullPage: true,
    });
  } catch {
    // best effort on the error screenshot
  }
} finally {
  await interruptAndWait(pairOpen);
  await browser.browser.close();
}

process.exit(ok ? 0 : 1);
