/**
 * Pinned model routing — when a chat carries `pinnedModel`, the
 * relay's `pickModel` returns that pinned model regardless of the
 * default routing logic (text-length / thinking-trigger).
 *
 * The CLI doesn't have a "pin model" verb (the widget sets
 * `pinnedModel` via UI), so this test pins the value via env-var
 * test hook on chat send.
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

const ADMIN_HOME = '/tmp/fairfox-e2e-pinned-admin';
const PHONE_HOME = '/tmp/fairfox-e2e-pinned-phone';

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

const relay = spawnCli('relay', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: 'pinned ok',
});
try {
  await waitForLine(relay.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relay ready');
  await new Promise((r) => setTimeout(r, 5000));

  // A short message would normally route to sonnet (haiku is
  // disabled). With pinnedModel = opus, the relay should log
  // "processing … via claude-opus-4-7".
  const send = await runCli(['chat', 'send', 'short'], PHONE_HOME, {
    FAIRFOX_CHAT_SEND_PINNED_MODEL: 'claude-opus-4-7',
  });
  if (send.status !== 0) {
    fail(`chat send (pinned) failed: ${send.stderr.slice(0, 200)}`);
  }
  const probeId = send.stdout.match(/wrote message (\S+)/)?.[1] ?? '';

  const processedLine = await waitForLine(
    relay.stdout,
    new RegExp(`\\[chat serve\\] processing ${probeId.replace(/-/g, '\\-')} via (\\S+)`),
    30_000,
    'relay processing line'
  );
  const usedModel = processedLine[1] ?? '';
  if (usedModel !== 'claude-opus-4-7') {
    fail(`pinned model ignored — relay used ${usedModel} instead of claude-opus-4-7`);
  }

  pass(`pinned model honoured: relay routed to ${usedModel} for a short message`);
} finally {
  await killAndWait(relay).catch(() => undefined);
}
