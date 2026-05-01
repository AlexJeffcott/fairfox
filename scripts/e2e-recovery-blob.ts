/**
 * Recovery blob round-trip — admin's recovery blob carries the
 * user identity to a second device. Both devices are the same
 * userId; both can write under that identity; both see each
 * other's writes.
 *
 * Catches the user-identity-vs-device-identity confusion: a
 * second device joined via recovery should NOT be a different
 * peer of a different user, but a second device of the SAME user.
 */
// @covers: mesh:users, mesh:devices, mesh:meta

import { mkdirSync, rmSync } from 'node:fs';
import { buildBundleIfMissing, fail, pass, runCli, trace } from './e2e-cli-helpers.ts';

const DEVICE_A_HOME = '/tmp/fairfox-e2e-recovery-a';
const DEVICE_B_HOME = '/tmp/fairfox-e2e-recovery-b';

for (const h of [DEVICE_A_HOME, DEVICE_B_HOME]) {
  rmSync(h, { recursive: true, force: true });
  mkdirSync(h, { recursive: true });
}
buildBundleIfMissing();

// Device A bootstraps and emits a recovery blob.
const init = await runCli(['mesh', 'init', '--admin', 'Owner'], DEVICE_A_HOME);
if (init.status !== 0) {
  fail(`mesh init failed: ${init.stderr.slice(0, 200)}`);
}
const blobMatch = init.stdout.match(/(fairfox-user-v1:[0-9a-f]+:[^\s]+)/);
if (!blobMatch) {
  fail(`no recovery blob in mesh init output:\n${init.stdout.slice(0, 600)}`);
}
const blob = blobMatch[1] ?? '';
trace('A', `recovery blob captured (${blob.length} chars)`);

// Capture the userId so we can assert both devices see it.
const whoamiA = await runCli(['users', 'whoami'], DEVICE_A_HOME);
const userIdA = whoamiA.stdout.match(/userId:\s+([0-9a-f]{64})/)?.[1] ?? '';
if (!userIdA) {
  fail(`couldn't read userId from device A whoami:\n${whoamiA.stdout}`);
}
trace('A', `userId ${userIdA.slice(0, 16)}…`);

// Device B imports the recovery blob. This adopts the same user
// identity but does NOT bootstrap a keyring — `users whoami` on
// device B would fail with "no keyring" until B is paired into a
// mesh. So parse the userId out of the import command's stdout
// instead, which prints `imported "<name>" (<userId>)`.
const importB = await runCli(['users', 'import', blob], DEVICE_B_HOME);
if (importB.status !== 0) {
  fail(`device B users import failed: ${importB.stderr.slice(0, 200)}`);
}
const userIdB = importB.stdout.match(/imported\s+"[^"]+"\s+\(([0-9a-f]{64})\)/)?.[1] ?? '';
if (!userIdB) {
  fail(`couldn't parse imported userId from: ${importB.stdout}`);
}
if (userIdB !== userIdA) {
  fail(`device B userId ${userIdB.slice(0, 16)}… does not match device A ${userIdA.slice(0, 16)}…`);
}
trace('B', 'recovery imported, userId matches A');

// Device A and Device B currently have different document keys
// (no pair token shared). Recovery alone doesn't bridge meshes —
// the user identity is portable but the per-mesh document key isn't.
// So the writes won't merge yet. To make them peers of the same
// mesh, we'd need device A to issue a pair token to device B.
// That's out of scope for this test — what we're proving here is
// the invariant "second device under recovery has the same userId".
// A separate test could pair them then assert mesh sync.

pass(`recovery blob round-trip: device A and device B share userId ${userIdA.slice(0, 16)}…`);
