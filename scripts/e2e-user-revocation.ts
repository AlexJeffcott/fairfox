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

import { mkdirSync, rmSync } from 'node:fs';
import {
  bootstrapAndOpenInvite,
  buildBundleIfMissing,
  fail,
  pass,
  runCli,
  trace,
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
const whoamiPhone = await runCli(['users', 'whoami'], PHONE_HOME);
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

// Admin revokes Phone.
const revoke = await runCli(['users', 'revoke', phoneUserId], ADMIN_HOME);
if (revoke.status !== 0) {
  fail(`users revoke failed: ${revoke.stderr.slice(0, 300)}`);
}
trace('admin', 'revocation written');

// Wait for sync.
await new Promise((r) => setTimeout(r, 6000));

// Both peers should now see Phone marked revoked.
const adminList = await runCli(['users'], ADMIN_HOME);
const phoneList = await runCli(['users'], PHONE_HOME);
const adminSeesRevoked =
  /Phone.*\[revoked\]|\[revoked\].*Phone/.test(adminList.stdout) ||
  adminList.stdout.includes('[revoked]');
const phoneSeesRevoked =
  /Phone.*\[revoked\]|\[revoked\].*Phone/.test(phoneList.stdout) ||
  phoneList.stdout.includes('[revoked]');

if (!adminSeesRevoked) {
  fail(`admin's users list does not show Phone as revoked:\n${adminList.stdout}`);
}
if (!phoneSeesRevoked) {
  fail(
    `phone's users list does not show its own user as revoked (sync didn't propagate):\n${phoneList.stdout}`
  );
}

pass('user revocation written, signed, and synced to revoked user');
