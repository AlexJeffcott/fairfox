/**
 * Daemon leader-lease handoff — two `chat serve` instances on the
 * same mesh (different keyrings) compete for the lease. The
 * first holder processes pendings; the second waits. Kill the
 * leader; the loser becomes leader within ~LEASE_TTL_MS (30 s)
 * and picks up subsequent work.
 *
 * Catches: double-replies (two relays processing the same
 * pending), and the "lease never times out, second relay never
 * gets to work" regression.
 */

import { mkdirSync, rmSync } from 'node:fs';
import {
  bootstrapAndOpenInvite,
  buildBundleIfMissing,
  fail,
  killAndWait,
  openExistingInvite,
  pass,
  runCli,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';

const ADMIN_HOME = '/tmp/fairfox-e2e-lease-admin';
const RELAY2_HOME = '/tmp/fairfox-e2e-lease-relay2';
const SENDER_HOME = '/tmp/fairfox-e2e-lease-sender';

for (const h of [ADMIN_HOME, RELAY2_HOME, SENDER_HOME]) {
  rmSync(h, { recursive: true, force: true });
  mkdirSync(h, { recursive: true });
}
buildBundleIfMissing();

// Three users: Admin (relay A), Relay2 (relay B), Sender (briefly
// authors messages). Two relay-capable users each run their own
// chat serve. The sender runs short-lived `chat send` and `chat
// dump` invocations against the same mesh.
const senderInvite = await bootstrapAndOpenInvite({
  adminHome: ADMIN_HOME,
  adminName: 'Admin',
  invitees: [{ name: 'Relay2', role: 'admin' }, { name: 'Sender' }],
  inviteToOpen: 'sender',
});
await runCli(['pair', senderInvite.shareUrl], SENDER_HOME);
await new Promise((r) => setTimeout(r, 4000));
await senderInvite.close();
trace('sender', 'paired');

const relay2Invite = await openExistingInvite(ADMIN_HOME, 'relay2');
await runCli(['pair', relay2Invite.shareUrl], RELAY2_HOME);
await new Promise((r) => setTimeout(r, 4000));
await relay2Invite.close();
trace('relay2', 'paired');

const relayA = spawnCli('relayA', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: 'reply from A',
});
await waitForLine(relayA.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relayA ready');
await new Promise((r) => setTimeout(r, 4000));
const relayB = spawnCli('relayB', ['chat', 'serve'], RELAY2_HOME, {
  FAIRFOX_CLAUDE_STUB: 'reply from B',
});
await waitForLine(relayB.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relayB ready');
// Wait for the two relays to discover each other so the lease
// negotiation has both candidates online.
await waitForLine(relayA.stdout, /peers=1/, 30_000, 'relayA sees a peer');
await waitForLine(relayB.stdout, /peers=1/, 30_000, 'relayB sees a peer');
await new Promise((r) => setTimeout(r, 5000));

try {
  // First message — exactly one of the two relays should process it.
  const send1 = await runCli(['chat', 'send', `lease test 1 ${Date.now()}`], SENDER_HOME);
  const id1 = send1.stdout.match(/wrote message (\S+)/)?.[1] ?? '';
  trace('sender', `sent ${id1}`);
  // Wait long enough that BOTH relays would have had a chance to
  // process. If both did, we'll see two replies.
  await new Promise((r) => setTimeout(r, 15_000));
  const dump1 = await runCli(['chat', 'dump'], SENDER_HOME);
  const doc1: { messages?: { sender: string; parentId?: string; text?: string }[] } = JSON.parse(
    dump1.stdout.slice(dump1.stdout.indexOf('{'))
  );
  const replies1 =
    doc1.messages?.filter((m) => m.sender === 'assistant' && m.parentId === id1) ?? [];
  if (replies1.length !== 1) {
    fail(`expected exactly 1 reply (lease should serialize processing), got ${replies1.length}`);
  }
  const initialLeader = replies1[0]?.text?.includes('reply from A') ? 'A' : 'B';
  trace('result', `initial leader = ${initialLeader}, ${replies1[0]?.text}`);

  // Kill the current leader; the loser should pick up the next pending.
  if (initialLeader === 'A') {
    await killAndWait(relayA);
    trace('test', 'killed relayA, waiting for relayB to claim lease');
  } else {
    await killAndWait(relayB);
    trace('test', 'killed relayB, waiting for relayA to claim lease');
  }
  // Lease TTL is 30 s. Give the survivor a window to reclaim.
  await new Promise((r) => setTimeout(r, 35_000));

  const send2 = await runCli(['chat', 'send', `lease test 2 ${Date.now()}`], SENDER_HOME);
  const id2 = send2.stdout.match(/wrote message (\S+)/)?.[1] ?? '';
  trace('sender', `sent ${id2}`);
  await new Promise((r) => setTimeout(r, 20_000));
  const dump2 = await runCli(['chat', 'dump'], SENDER_HOME);
  const doc2: { messages?: { sender: string; parentId?: string; text?: string }[] } = JSON.parse(
    dump2.stdout.slice(dump2.stdout.indexOf('{'))
  );
  const replies2 =
    doc2.messages?.filter((m) => m.sender === 'assistant' && m.parentId === id2) ?? [];
  if (replies2.length !== 1) {
    fail(`expected exactly 1 reply post-failover, got ${replies2.length}`);
  }
  const newLeader = replies2[0]?.text?.includes('reply from A') ? 'A' : 'B';
  if (newLeader === initialLeader) {
    fail(`leader didn't change after killing the original — handoff broken`);
  }
  pass(`lease handoff: ${initialLeader} → ${newLeader}, no double-replies`);
} finally {
  await killAndWait(relayA).catch(() => undefined);
  await killAndWait(relayB).catch(() => undefined);
}
