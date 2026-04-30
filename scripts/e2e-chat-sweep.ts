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

// Author the backdated pending BEFORE any relay runs. With no
// relay online, no tick fires against the pending — the message
// just sits in admin's chat:main on disk, ready to be picked up
// by the next relay's startup sweep. This avoids a race where a
// "priming relay" ticks fast enough to process the backdated
// message before we can kill it (the tick interval is short, and
// chat.ts processes pendings regardless of staleness — only
// startup-sweep is staleness-aware).
const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
const send = await runCli(['chat', 'send', 'pretend old pending'], ADMIN_HOME, {
  FAIRFOX_CHAT_SEND_CREATED_AT: fiveMinAgo,
});
if (send.status !== 0) {
  fail(`backdated send failed: ${send.stderr.slice(0, 200)}`);
}
const probeId = send.stdout.match(/wrote message (\S+)/)?.[1] ?? '';
trace('admin', `wrote backdated pending ${probeId} at ${fiveMinAgo}`);

// Phone-serve is a long-lived peer that mirrors chat:main back to
// phone storage so the brief `chat dump` at the end can read the
// swept reply.
const phoneServe = spawnCli('phone-serve', ['chat', 'serve'], PHONE_HOME, {
  FAIRFOX_CLAUDE_STUB: 'phone should not process anything',
});
try {
  await waitForLine(
    phoneServe.stdout,
    /\[chat serve\] chat:main loaded/,
    30_000,
    'phone-serve ready'
  );

  const relay = spawnCli('relay', ['chat', 'serve'], ADMIN_HOME, {
    FAIRFOX_CLAUDE_STUB: 'this should NOT be the reply for the swept pending',
  });
  try {
    await waitForLine(relay.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relay ready');
    await waitForLine(
      relay.stdout,
      /\[chat serve\] swept \d+ stale pending message/,
      5000,
      'sweep log'
    );
    trace('relay', 'startup sweep fired');

    // Wait for the sweep write to propagate to phone-serve.
    await new Promise((r) => setTimeout(r, 8000));
    await killAndWait(phoneServe);

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
} finally {
  await killAndWait(phoneServe).catch(() => undefined);
}
