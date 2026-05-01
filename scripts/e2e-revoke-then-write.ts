/**
 * Revocation enforcement — once an admin revokes a member, the
 * member's subsequent writes must NOT land in the admin's view of
 * `chat:main`. Mutation testing rounds 1, 2 and 3 found three
 * independent ways to break revocation that the existing
 * `e2e-user-revocation.ts` happily passed because it only checks
 * the visible `[revoked]` row, not the security boundary the row
 * exists to enforce. This is the test that tightens the boundary.
 *
 * Three failure modes this is designed to catch once enforcement
 * is wired up:
 *
 *   - B3: receive-side gate skipped — `MeshNetworkAdapter.tryUnwrap`
 *     no longer drops messages from `revokedPeers`.
 *   - B10: `applyRevocation` adds the wrong peer to `revokedPeers`
 *     (e.g. revokes the issuer instead of the named target).
 *   - B13: `decodeRevocation` skips the `revocationAuthority` check,
 *     letting any peer issue revocations.
 *
 * Status: **currently FAILS on a pristine polly 0.36.0.** The
 * failure is the test's job — it documents the gap mutation
 * testing surfaced. There are TWO blockers stacked here:
 *
 *   1. The fairfox-side wire-up exists in spirit only. `users.ts`
 *      now calls `revokeDevice` for every peerId in
 *      `mesh:devices` whose `ownerUserIds` includes the target —
 *      see the loop at the bottom of `usersRevoke`.
 *
 *   2. The data that loop reads from is silently dropped by an
 *      Automerge map-replacement race: `mesh:devices` updates go
 *      through `applyTopLevel` (`node_modules/@fairfox/polly/
 *      dist/src/mesh.js:1735`) which writes
 *      `doc.devices = newMap` for the whole top-level
 *      `devices` field. Concurrent writes from issuer (admin
 *      writing the new device row in `acceptReturnToken`) and
 *      scanner (member writing endorsement during
 *      `addEndorsementToDevice`) both replace the whole map;
 *      Automerge picks one winner by hash-of-actor-id and the
 *      other side's row is dropped. Result: `mesh:devices`
 *      converges WITHOUT `ownerUserIds` populated, so the
 *      `users revoke` loop has nothing to look up.
 *
 *      The fix is to operate on `doc.devices[peerId]` per-key via
 *      `handle.change` instead of replacing the whole map. That's
 *      a change in `packages/shared/src/devices-state.ts:upsertDeviceEntry`
 *      and propagates through every fairfox sub-app that writes
 *      via `devicesState.value = …`. Out of scope for this
 *      session; the test stays here as the spec for that work.
 *
 * The test is therefore deliberately excluded from
 * `scripts/e2e-all.ts` until both blockers are unstuck.
 *
 * Flow (intended once enforcement lands):
 *
 *   1. Pair admin + member.
 *   2. Both run `chat serve` so writes can replicate.
 *   3. Member sends "before-revocation" — admin receives it.
 *   4. Admin runs `users revoke <member>`. Sync window.
 *   5. Member sends "after-revocation". Sync window.
 *   6. Stop both relays, dump admin's chat:main from local storage.
 *   7. Assert: admin sees "before-revocation", does NOT see
 *      "after-revocation".
 *
 * Run with:  bun scripts/e2e-revoke-then-write.ts
 */
// @covers: chat:main, chat:health, daemon:leader, mesh:users, mesh:devices, mesh:meta

import { mkdirSync, rmSync } from 'node:fs';
import {
  bootstrapAndOpenInvite,
  buildBundleIfMissing,
  fail,
  killAndWait,
  lastHeartbeatLine,
  pass,
  runCli,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';

const ADMIN_HOME = '/tmp/fairfox-e2e-revoke-write-admin';
const MEMBER_HOME = '/tmp/fairfox-e2e-revoke-write-member';

for (const h of [ADMIN_HOME, MEMBER_HOME]) {
  rmSync(h, { recursive: true, force: true });
  mkdirSync(h, { recursive: true });
}
buildBundleIfMissing();

const invite = await bootstrapAndOpenInvite({
  adminHome: ADMIN_HOME,
  adminName: 'Admin',
  invitees: [{ name: 'Member' }],
  inviteToOpen: 'member',
});
await runCli(['pair', invite.shareUrl], MEMBER_HOME);
await new Promise((r) => setTimeout(r, 4000));
await invite.close();
trace('member', 'paired');

const whoamiMember = await runCli(['users', 'whoami'], MEMBER_HOME);
const memberUserId = whoamiMember.stdout.match(/userId:\s+([0-9a-f]{64})/)?.[1] ?? '';
if (!memberUserId) {
  fail(`couldn't read member userId:\n${whoamiMember.stdout}`);
}
trace('member', `userId ${memberUserId.slice(0, 16)}…`);

// ------------------------------------------------------------------
// Phase 1: bring both peers online; member sends a pre-revocation
// message; admin's relay accepts and records it.
// ------------------------------------------------------------------

let adminServer = spawnCli('admin-serve', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: 'admin-stub-reply',
});
const memberServer = spawnCli('member-serve', ['chat', 'serve'], MEMBER_HOME, {
  FAIRFOX_CLAUDE_STUB: 'member-stub-reply',
});

try {
  await waitForLine(
    adminServer.stdout,
    /\[chat serve\] chat:main loaded/,
    30_000,
    'admin server ready'
  );
  await waitForLine(
    memberServer.stdout,
    /\[chat serve\] chat:main loaded/,
    30_000,
    'member server ready'
  );
  await waitForLine(adminServer.stdout, /peers=1/, 30_000, 'admin sees member peer', () =>
    lastHeartbeatLine(adminServer.stdout)
  );

  // Pre-revocation send: a brief CLI from the member's home will
  // collide on signalling with member-serve (same peerId). Stop
  // member-serve, send, restart.
  await killAndWait(memberServer);
  const preSend = await runCli(['chat', 'send', 'before-revocation hello'], MEMBER_HOME);
  if (preSend.status !== 0) {
    fail(`member pre-revocation send failed: ${preSend.stderr.slice(0, 200)}`);
  }
  trace('member', 'sent before-revocation message');

  // Restart member-serve so the message can replicate to admin.
  // Re-spawn with the same args; mutate the handle reference for the
  // outer try/finally so cleanup still works.
  const memberServer2 = spawnCli('member-serve', ['chat', 'serve'], MEMBER_HOME, {
    FAIRFOX_CLAUDE_STUB: 'member-stub-reply',
  });
  try {
    await waitForLine(memberServer2.stdout, /peers=1/, 30_000, 'member-serve(2) reconnects', () =>
      lastHeartbeatLine(memberServer2.stdout)
    );
    await new Promise((r) => setTimeout(r, 6000));
  } finally {
    await killAndWait(memberServer2).catch(() => undefined);
  }

  // ----------------------------------------------------------------
  // Phase 2: admin revokes the member.
  // ----------------------------------------------------------------

  // Stop admin-serve so the brief `users revoke` doesn't conflict on
  // the admin keyring's peerId.
  await killAndWait(adminServer);
  const revoke = await runCli(['users', 'revoke', memberUserId], ADMIN_HOME);
  if (revoke.status !== 0) {
    fail(`admin revoke failed: ${revoke.stderr.slice(0, 300)}`);
  }
  trace('admin', `revoked ${memberUserId.slice(0, 16)}…`);

  adminServer = spawnCli('admin-serve', ['chat', 'serve'], ADMIN_HOME, {
    FAIRFOX_CLAUDE_STUB: 'admin-stub-reply',
  });
  await waitForLine(
    adminServer.stdout,
    /\[chat serve\] chat:main loaded/,
    30_000,
    'admin server (2) ready'
  );

  // Bring member back online so admin can broadcast the revocation
  // (mesh:users) to it. We do not need member to APPLY the
  // revocation locally — the enforcement happens on admin's
  // tryUnwrap.
  const memberServer3 = spawnCli('member-serve', ['chat', 'serve'], MEMBER_HOME, {
    FAIRFOX_CLAUDE_STUB: 'member-stub-reply',
  });
  try {
    await waitForLine(
      adminServer.stdout,
      /peers=1/,
      30_000,
      'admin sees member peer (post-revoke)',
      () => lastHeartbeatLine(adminServer.stdout)
    );
    // Sync window — admin pushes the revocation to member, both
    // sides reach a stable post-revocation state.
    await new Promise((r) => setTimeout(r, 8000));
  } finally {
    await killAndWait(memberServer3).catch(() => undefined);
  }

  // ----------------------------------------------------------------
  // Phase 3: member tries to write again. The receive gate on admin
  // should drop it.
  // ----------------------------------------------------------------

  const postSend = await runCli(['chat', 'send', 'after-revocation hello'], MEMBER_HOME);
  if (postSend.status !== 0) {
    fail(`member post-revocation send failed: ${postSend.stderr.slice(0, 200)}`);
  }
  trace('member', 'sent after-revocation message');

  // Bring member back online once more so any pending sync attempts
  // for the post-revocation write have their chance to land.
  const memberServer4 = spawnCli('member-serve', ['chat', 'serve'], MEMBER_HOME, {
    FAIRFOX_CLAUDE_STUB: 'member-stub-reply',
  });
  try {
    await new Promise((r) => setTimeout(r, 8000));
  } finally {
    await killAndWait(memberServer4).catch(() => undefined);
  }

  // ----------------------------------------------------------------
  // Phase 4: dump admin's chat:main and assert.
  // ----------------------------------------------------------------

  await killAndWait(adminServer);
  const dump = await runCli(['chat', 'dump'], ADMIN_HOME);
  const beforeSeen = dump.stdout.includes('before-revocation hello');
  const afterSeen = dump.stdout.includes('after-revocation hello');

  if (!beforeSeen) {
    fail(
      'admin did not see the pre-revocation message — sync was broken before the revocation step,\n' +
        `so the test cannot conclude anything about enforcement. dump head:\n${dump.stdout.slice(0, 600)}`
    );
  }
  if (afterSeen) {
    fail(
      `admin received "after-revocation hello" from a revoked member.\n` +
        'Either the receive-side revocation gate is broken (round-1 B3),\n' +
        'or applyRevocation added the wrong peer to revokedPeers (round-2 B10),\n' +
        'or the revocation-authority check was skipped on decode (round-3 B13).\n' +
        `dump head:\n${dump.stdout.slice(0, 600)}`
    );
  }

  pass('revoked member writes are dropped at the admin receive gate');
} finally {
  await killAndWait(adminServer).catch(() => undefined);
  await killAndWait(memberServer).catch(() => undefined);
}
