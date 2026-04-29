/**
 * Sweep marks genuinely-old pendings — phone writes a pending
 * timestamped 5 min in the past, laptop relay starts, the
 * startup `sweepStaleTurns` flips that pending to false and
 * writes an `error: daemon-restarted` reply so the widget can
 * surface a regenerate affordance.
 *
 * Pairs with the "fresh pending isn't swept" assertion in
 * e2e-chat-full.ts: together they prove the sweep window is
 * "older than STALE_TURN_MS, never younger".
 */

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

const ADMIN_HOME = '/tmp/fairfox-e2e-sweep-admin';
const PHONE_HOME = '/tmp/fairfox-e2e-sweep-phone';

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

// Without an active laptop relay during the phone's send, the
// phone's pending only lives in phone storage — sync needs a peer.
// So: start a relay first to absorb the write, then kill it, then
// restart so the startup sweep sees the backdated pending in
// laptop storage.
const primingRelay = spawnCli('priming-relay', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: 'priming should not run on backdated pending',
});
await waitForLine(
  primingRelay.stdout,
  /\[chat serve\] chat:main loaded/,
  30_000,
  'priming relay ready'
);
await new Promise((r) => setTimeout(r, 5000));

// Phone sends a pending dated 5 minutes ago. STALE_TURN_MS in
// chat.ts is 2 min, so this is solidly outside the live window.
// pickNextPending sorts by createdAt — the backdated message
// looks "old" to the relay's normal processing too, but the
// relay's tick fires on a 5 s interval, so we kill the priming
// relay quickly to deny it a chance to process before sweep.
const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
const send = await runCli(['chat', 'send', 'pretend old pending'], PHONE_HOME, {
  FAIRFOX_CHAT_SEND_CREATED_AT: fiveMinAgo,
});
if (send.status !== 0) {
  await killAndWait(primingRelay).catch(() => undefined);
  fail(`backdated send failed: ${send.stderr.slice(0, 200)}`);
}
const probeId = send.stdout.match(/wrote message (\S+)/)?.[1] ?? '';
trace('phone', `sent backdated pending ${probeId} at ${fiveMinAgo}`);
// Sync the write into the laptop's chat:main quickly, then kill
// the priming relay before its 5 s tick reaches the message.
await new Promise((r) => setTimeout(r, 3000));
await killAndWait(primingRelay);
trace('test', 'priming relay killed before tick reached backdated pending');

const relay = spawnCli('relay', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: 'this should NOT be the reply for the swept pending',
});
try {
  await waitForLine(relay.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relay ready');
  // The startup sweep should have logged "swept N stale pending"
  // immediately after chat:main loaded.
  await waitForLine(
    relay.stdout,
    /\[chat serve\] swept \d+ stale pending message/,
    5000,
    'sweep log'
  );
  trace('relay', 'startup sweep fired');

  // Wait for the sweep write to propagate to the phone.
  await new Promise((r) => setTimeout(r, 8000));

  const dump = await runCli(['chat', 'dump'], PHONE_HOME);
  const doc: {
    messages?: {
      id: string;
      sender: string;
      pending: boolean;
      parentId?: string;
      error?: { kind: string };
      text?: string;
    }[];
  } = JSON.parse(dump.stdout.slice(dump.stdout.indexOf('{')));
  const userMsg = doc.messages?.find((m) => m.id === probeId);
  if (!userMsg) {
    fail('backdated user message missing from chat:main entirely');
  }
  if (userMsg.pending !== false) {
    fail(`sweep did not flip pending=false (still ${userMsg.pending})`);
  }
  const reply = doc.messages?.find((m) => m.sender === 'assistant' && m.parentId === probeId);
  if (!reply) {
    fail(`sweep did not write a reply for ${probeId}`);
  }
  if (reply.error?.kind !== 'daemon-restarted') {
    fail(
      `sweep wrote a reply but error.kind is ${reply.error?.kind ?? '(none)'}, expected daemon-restarted`
    );
  }
  if (reply.text?.includes('this should NOT')) {
    fail(`sweep didn't fire — relay actually processed the old pending normally`);
  }
  pass('sweep marked old pending as daemon-restarted, regenerate path enabled');
} finally {
  await killAndWait(relay).catch(() => undefined);
}
