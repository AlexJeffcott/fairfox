/**
 * Pinned model routing — when a chat carries `pinnedModel`, the
 * relay's `pickModel` returns that pinned model regardless of the
 * default routing logic (text-length / thinking-trigger).
 *
 * The CLI doesn't have a "pin model" verb (the widget sets
 * `pinnedModel` via UI), so this test pins the value via env-var
 * test hook on chat send.
 */
// @covers: chat:main, chat:health, daemon:leader, mesh:users, mesh:devices, mesh:meta

import { mkdirSync, rmSync } from 'node:fs';
import { delay } from '@fairfox/shared/timers';
import {
  buildBundleIfMissing,
  fail,
  interruptAndWait,
  killAndWait,
  pairWithShare,
  pass,
  runCli,
  spawnCli,
  waitForLine,
} from './e2e-cli-helpers.ts';

const ADMIN_HOME = '/tmp/fairfox-e2e-pinned-admin';
const PHONE_HOME = '/tmp/fairfox-e2e-pinned-phone';
const JOIN_URL_RE = /(https?:\/\/\S*#pair=\S+)/;

for (const h of [ADMIN_HOME, PHONE_HOME]) {
  rmSync(h, { recursive: true, force: true });
  mkdirSync(h, { recursive: true });
}
buildBundleIfMissing();

const init = await runCli(
  ['init', 'e2e mesh', '--admin', 'Admin', '--user', 'Phone:member'],
  ADMIN_HOME
);
if (init.status !== 0) {
  fail(`mesh init failed: ${init.stderr.slice(0, 200)}`);
}
const inviteOpen = spawnCli('invite-phone', ['pair', 'open', '--user', 'phone'], ADMIN_HOME);
const joinMatch = await waitForLine(inviteOpen.stdout, JOIN_URL_RE, 15_000, 'join URL for phone');
const shareUrl = (joinMatch[1] ?? '').replace(/[)\].,]+$/, '');
await pairWithShare(PHONE_HOME, shareUrl, inviteOpen);
await interruptAndWait(inviteOpen);

const relay = spawnCli('relay', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: 'pinned ok',
});
try {
  await waitForLine(relay.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relay ready');
  // Slack for the relay's mesh client to finish subscribing to
  // chat:main before the phone's one-shot write. No peer is live to
  // poll for — the phone only connects briefly during `chat send`.
  await delay(5000);

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
