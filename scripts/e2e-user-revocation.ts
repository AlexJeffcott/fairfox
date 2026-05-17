/**
 * User revocation — admin revokes a paired user; the revocation
 * is written into mesh:users with the admin's signature; both the
 * admin and the revoked user's `users list` reflect `[revoked]`.
 *
 * The full enforcement story (revoked user's writes rejected at
 * accept hook) lives in polly's accept layer; this test asserts
 * the visible part of the flow — revocation is signed, written,
 * and replicates to the revoked user.
 */
// @covers: chat:main, chat:health, daemon:leader, mesh:users, mesh:devices, mesh:meta

import { mkdirSync, rmSync } from 'node:fs';
import {
  bootstrapAndOpenInvite,
  buildBundleIfMissing,
  fail,
  killAndWait,
  pass,
  runCli,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';

const ADMIN_HOME = '/tmp/fairfox-e2e-revoke-admin';
const PHONE_HOME = '/tmp/fairfox-e2e-revoke-phone';

for (const h of [ADMIN_HOME, PHONE_HOME]) {
  rmSync(h, { recursive: true, force: true });
  mkdirSync(h, { recursive: true });
}
buildBundleIfMissing();

const invite = await bootstrapAndOpenInvite({
  adminHome: ADMIN_HOME,
  adminName: 'Admin',
  invitees: [{ name: 'Phone' }],
  inviteToOpen: 'phone',
});
await runCli(['pair', invite.shareUrl], PHONE_HOME);
await new Promise((r) => setTimeout(r, 4000));
await invite.close();
trace('phone', 'paired');

// Capture phone's userId.
const whoamiPhone = await runCli(['whoami'], PHONE_HOME);
const phoneUserId = whoamiPhone.stdout.match(/userId:\s+([0-9a-f]{64})/)?.[1] ?? '';
if (!phoneUserId) {
  fail(`couldn't read phone userId:\n${whoamiPhone.stdout}`);
}
trace('phone', `userId ${phoneUserId.slice(0, 16)}…`);

// Admin's listing should show Phone unrevoked.
{
  const list = await runCli(['users'], ADMIN_HOME);
  if (list.stdout.includes('[revoked]')) {
    fail(
      `admin's users list already shows a [revoked] entry before any revocation:\n${list.stdout}`
    );
  }
}

// Admin revokes Phone (briefly opens mesh, writes locally, exits).
const revoke = await runCli(['revoke', phoneUserId], ADMIN_HOME);
if (revoke.status !== 0) {
  fail(`users revoke failed: ${revoke.stderr.slice(0, 300)}`);
}
trace('admin', 'revocation written to admin storage');

// Bring both peers online via `chat serve` so the revocation can
// replicate from admin → phone over real WebRTC. Each home has its
// own keyring and peerId, so they coexist on the signalling
// server. After replication, kill phone-serve and read phone's
// users list from local storage.
const adminServer = spawnCli('admin-serve', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: 'placeholder',
});
const phoneServer = spawnCli('phone-serve', ['chat', 'serve'], PHONE_HOME, {
  FAIRFOX_CLAUDE_STUB: 'placeholder',
});
try {
  await waitForLine(
    adminServer.stdout,
    /\[chat serve\] chat:main loaded/,
    30_000,
    'admin server ready'
  );
  await waitForLine(
    phoneServer.stdout,
    /\[chat serve\] chat:main loaded/,
    30_000,
    'phone server ready'
  );
  await waitForLine(adminServer.stdout, /peers=1/, 30_000, 'admin sees phone peer');
  await waitForLine(phoneServer.stdout, /peers=1/, 30_000, 'phone sees admin peer');
  // mesh:users convergence: wait until phone's heartbeat shows
  // mesh:users=rx/tx with rx >= 1, i.e. at least one sync message
  // landed against that doc. Without this, the previous 8-s sleep
  // was a coin flip: sync messages cross the channel in seconds,
  // but the heartbeat that surfaces them ticks every 10 s, and
  // the doc was sometimes still empty when the test killed the
  // server.
  await waitForLine(
    phoneServer.stdout,
    /mesh:users=[1-9]\d*\/\d+/,
    30_000,
    'phone mesh:users converges'
  );
} catch (e) {
  await killAndWait(adminServer).catch(() => undefined);
  await killAndWait(phoneServer).catch(() => undefined);
  throw e;
}

// Stop the phone's serve so a fresh `users` invocation reads from
// the same on-disk storage phone-serve was writing to. Use a 12-s
// SIGTERM-to-exit budget: chat serve's shutdown does
// `flushOutgoing(2000)` and then a two-pass `repo.flush()` via
// `closeMesh`, which together can run past the default 3-s wait.
// Returning before the flush completes was the durability race
// behind one of the user-revocation flake modes — the on-disk
// mesh:users file lagged the in-memory doc by the unflushed
// window. See issue #26.
await killAndWait(phoneServer, 12_000);

try {
  const adminList = await runCli(['users'], ADMIN_HOME);
  if (!adminList.stdout.includes('[revoked]')) {
    fail(`admin's users list does not show Phone as revoked:\n${adminList.stdout}`);
  }

  // Phone's fresh `users` invocation opens its own polly Repo and
  // reads from on-disk storage. `usersList()` budgets 3 s for
  // `mesh:users.loaded`, which is sometimes tight after a cold
  // mesh open against many docs on disk — the index doc resolves
  // `mesh:users → docId` and the named doc itself both need to
  // hydrate. Retry up to 30 s so a slow first hydration doesn't
  // race the assertion. See issue #26.
  const phoneDeadline = Date.now() + 30_000;
  let phoneList = await runCli(['users'], PHONE_HOME);
  while (!phoneList.stdout.includes('[revoked]') && Date.now() < phoneDeadline) {
    await new Promise((r) => setTimeout(r, 2000));
    phoneList = await runCli(['users'], PHONE_HOME);
  }
  if (!phoneList.stdout.includes('[revoked]')) {
    fail(
      `phone's users list does not show its own user as revoked (sync didn't propagate):\n${phoneList.stdout}`
    );
  }

  pass('user revocation written, signed, and synced to revoked user');
} finally {
  await killAndWait(adminServer).catch(() => undefined);
}
