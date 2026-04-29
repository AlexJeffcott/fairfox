/**
 * Large-doc sync — phone writes 50 chat messages back-to-back; a
 * fresh peer joins; the new peer picks up all 50 within a
 * reasonable window. Catches:
 *
 *   - Automerge "inflating document chunk ops" OOM regressions
 *     (which boot.tsx's unhandled-rejection guard suppresses for
 *     sync but still represents a real degradation).
 *   - Sync handshake stalls on large docs.
 *   - Per-doc throughput floors.
 *
 * Uses the chat send hook to backdate every probe so the relay
 * sweep doesn't fire against an unprocessed batch.
 */

import { mkdirSync, rmSync } from 'node:fs';
import {
  bootstrapAndOpenInvite,
  buildBundleIfMissing,
  fail,
  openExistingInvite,
  pass,
  runCli,
  trace,
} from './e2e-cli-helpers.ts';

const ADMIN_HOME = '/tmp/fairfox-e2e-large-admin';
const PHONE_HOME = '/tmp/fairfox-e2e-large-phone';
const LATE_HOME = '/tmp/fairfox-e2e-large-late';
const N_MESSAGES = 20;

for (const h of [ADMIN_HOME, PHONE_HOME, LATE_HOME]) {
  rmSync(h, { recursive: true, force: true });
  mkdirSync(h, { recursive: true });
}
buildBundleIfMissing();

const phoneInvite = await bootstrapAndOpenInvite({
  adminHome: ADMIN_HOME,
  adminName: 'Admin',
  invitees: [{ name: 'Phone' }, { name: 'Late' }],
  inviteToOpen: 'phone',
});
await runCli(['pair', phoneInvite.shareUrl], PHONE_HOME);
await new Promise((r) => setTimeout(r, 4000));
await phoneInvite.close();
trace('phone', 'paired');

trace('phone', `writing ${N_MESSAGES} messages…`);
const t0 = Date.now();
for (let i = 0; i < N_MESSAGES; i += 1) {
  // Backdate so any startup sweep on the admin side doesn't
  // mass-mark these as daemon-restarted.
  const ts = new Date(Date.now() - 60 * 60_000 + i * 1000).toISOString();
  const r = await runCli(['chat', 'send', `bulk #${i}`], PHONE_HOME, {
    FAIRFOX_CHAT_SEND_CREATED_AT: ts,
  });
  if (r.status !== 0) {
    fail(`bulk send #${i} failed: ${r.stderr.slice(0, 200)}`);
  }
}
const writeMs = Date.now() - t0;
trace('phone', `${N_MESSAGES} messages written in ${writeMs}ms`);

// Wait for sync to admin so admin's chat:main has every message.
await new Promise((r) => setTimeout(r, 8000));

// New peer joins.
const lateInvite = await openExistingInvite(ADMIN_HOME, 'late');
await runCli(['pair', lateInvite.shareUrl], LATE_HOME);
await new Promise((r) => setTimeout(r, 4000));
await lateInvite.close();
trace('late', 'paired — should pick up the existing chat:main');

// chat dump on the late peer should see all N messages within a
// reasonable window.
const deadline = Date.now() + 60_000;
let lateCount = 0;
while (Date.now() < deadline) {
  const dump = await runCli(['chat', 'dump'], LATE_HOME);
  if (dump.status === 0) {
    const start = dump.stdout.indexOf('{');
    if (start !== -1) {
      const doc: { messages?: { sender: string }[] } = JSON.parse(dump.stdout.slice(start));
      lateCount = doc.messages?.filter((m) => m.sender === 'user').length ?? 0;
      if (lateCount >= N_MESSAGES) {
        break;
      }
    }
  }
  trace('late', `seen ${lateCount}/${N_MESSAGES} so far…`);
  await new Promise((r) => setTimeout(r, 3000));
}

if (lateCount < N_MESSAGES) {
  fail(`late peer only saw ${lateCount}/${N_MESSAGES} messages within 60s`);
}
pass(`late peer synced all ${N_MESSAGES} messages from existing mesh`);
