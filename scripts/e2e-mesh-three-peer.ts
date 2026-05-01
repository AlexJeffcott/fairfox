/**
 * Three-peer mesh — admin + two phones, all paired through the
 * same admin's invites. Phone1 sends a chat message; phone2 sees
 * it; the laptop relay sees both phones as peers and processes
 * the pending. Catches the "sync only flows pairwise" failure
 * mode where mesh:devices has 3 peers but ops only flow between
 * pairs that handshake first.
 */
// @covers: chat:main, chat:health, daemon:leader, mesh:users, mesh:devices, mesh:meta

import { mkdirSync, rmSync } from 'node:fs';
import {
  bootstrapAndOpenInvite,
  buildBundleIfMissing,
  fail,
  killAndWait,
  openExistingInvite,
  pass,
  runCli,
  type SubprocessHandle,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';

const ADMIN_HOME = '/tmp/fairfox-e2e-3peer-admin';
const PHONE1_HOME = '/tmp/fairfox-e2e-3peer-phone1';
const PHONE2_HOME = '/tmp/fairfox-e2e-3peer-phone2';
const STUB = 'three-peer stub';

for (const h of [ADMIN_HOME, PHONE1_HOME, PHONE2_HOME]) {
  rmSync(h, { recursive: true, force: true });
  mkdirSync(h, { recursive: true });
}
buildBundleIfMissing();

let chatServe: SubprocessHandle | undefined;

try {
  // Bootstrap admin with two invites at once.
  const phone1Invite = await bootstrapAndOpenInvite({
    adminHome: ADMIN_HOME,
    adminName: 'Admin',
    invitees: [{ name: 'Phone1' }, { name: 'Phone2' }],
    inviteToOpen: 'phone1',
  });
  trace('admin', 'mesh init done, invite for phone1 open');
  // Pair phone1 against the open invite (it's still a SubprocessHandle
  // internally — we don't have a direct ref, so use runCli + manually
  // wait for the ack on the next opened invite. Simpler: close this,
  // re-open per phone in turn.
  await runCli(['pair', phone1Invite.shareUrl], PHONE1_HOME);
  // Drain the pair ack from invite-phone1 by waiting briefly then
  // closing.
  await new Promise((r) => setTimeout(r, 5000));
  await phone1Invite.close();
  trace('phone1', 'paired');

  const phone2Invite = await openExistingInvite(ADMIN_HOME, 'phone2');
  await runCli(['pair', phone2Invite.shareUrl], PHONE2_HOME);
  await new Promise((r) => setTimeout(r, 5000));
  await phone2Invite.close();
  trace('phone2', 'paired');

  // Start the relay on the admin keyring.
  chatServe = spawnCli('relay', ['chat', 'serve'], ADMIN_HOME, {
    FAIRFOX_CLAUDE_STUB: STUB,
  });
  await waitForLine(chatServe.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relay ready');
  // Slack so both phones can complete WebRTC handshakes with the
  // relay before the first phone1 write lands.
  await new Promise((r) => setTimeout(r, 8000));

  // phone1 sends. The relay must process; phone2 must see both
  // messages (user + assistant) via mesh sync.
  const text = `three-peer ${Date.now()}`;
  const send = await runCli(['chat', 'send', text], PHONE1_HOME);
  if (send.status !== 0) {
    fail(`phone1 send failed: ${send.stderr.slice(0, 200)}`);
  }
  const idMatch = send.stdout.match(/wrote message (\S+) /);
  const probeId = idMatch?.[1] ?? '';
  trace('phone1', `sent ${probeId}`);
  await waitForLine(
    chatServe.stdout,
    new RegExp(`\\[chat serve\\] replied to ${probeId.replace(/-/g, '\\-')}`),
    30_000,
    'relay reply'
  );
  trace('relay', 'replied');

  // phone2's view of chat:main should include the user message AND
  // the assistant reply, even though phone2 didn't send anything.
  const deadline = Date.now() + 30_000;
  let phone2Sees = false;
  while (Date.now() < deadline) {
    const dump = await runCli(['chat', 'dump'], PHONE2_HOME);
    if (dump.status === 0) {
      const start = dump.stdout.indexOf('{');
      if (start !== -1) {
        const doc: { messages?: { sender: string; parentId?: string; id?: string }[] } = JSON.parse(
          dump.stdout.slice(start)
        );
        const userMsg = doc.messages?.find((m) => m.id === probeId);
        const reply = doc.messages?.find((m) => m.sender === 'assistant' && m.parentId === probeId);
        if (userMsg && reply) {
          phone2Sees = true;
          break;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!phone2Sees) {
    fail("phone2 never saw phone1's user message + the assistant reply");
  }

  pass('three-peer mesh: phone1 → relay → phone2 round-trip works');
} finally {
  if (chatServe) {
    await killAndWait(chatServe).catch(() => undefined);
  }
}
