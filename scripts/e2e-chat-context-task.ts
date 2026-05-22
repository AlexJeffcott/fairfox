/**
 * Cross-sub-app context resolution — the relay's prompt builder
 * pulls a todo task's body into the prompt when a chat message
 * carries a `task` context ref.
 *
 * Phone creates a todo task. Phone sends a chat message tagged
 * with that task as context. Relay's stub is set to echo the
 * full prompt back. The reply text should contain the task
 * description string.
 *
 * Catches the regression where chat.ts's `resolveContext` reads
 * from a doc id that has drifted from the todo sub-app's actual
 * doc id, returning `(no task X)` for valid tids.
 */
// @covers: chat:main, chat:health, daemon:leader, todo:tasks, todo:projects, agenda:main, mesh:users, mesh:devices, mesh:meta

import { mkdirSync, rmSync } from 'node:fs';
import {
  buildBundleIfMissing,
  fail,
  interruptAndWait,
  killAndWait,
  pairWithShare,
  pass,
  runCli,
  spawnCli,
  trace,
  waitForLine,
} from './e2e-cli-helpers.ts';
import { waitFor } from './e2e-config.ts';

const ADMIN_HOME = '/tmp/fairfox-e2e-ctx-admin';
const PHONE_HOME = '/tmp/fairfox-e2e-ctx-phone';
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
// pairWithShare runs `pair join` and waits for the issuer's real
// `✓ "phone" paired` ack — the pairing IS complete when that returns.
await pairWithShare(PHONE_HOME, shareUrl, inviteOpen);
await interruptAndWait(inviteOpen);
trace('phone', 'paired');

// Start the relay BEFORE phone writes the task so the brief
// phone-side write CLI has an online peer to sync to. Without
// this, the task lives only on phone's disk and the relay's
// resolveContext returns "(no task X)".
const relay = spawnCli('relay', ['chat', 'serve'], ADMIN_HOME, {
  FAIRFOX_CLAUDE_STUB: '__ECHO_PROMPT__',
});
try {
  await waitForLine(relay.stdout, /\[chat serve\] chat:main loaded/, 30_000, 'relay ready');

  // Phone creates a todo task with a recognisable description.
  // The relay is already online with todo:tasks loaded, so the
  // brief phone CLI's sync handshake will share the new task.
  const TASK_DESC = `e2e-context-task-${Date.now()}`;
  const taskAdd = await runCli(['todo', 'task', 'add', TASK_DESC], PHONE_HOME);
  if (taskAdd.status !== 0) {
    fail(`todo task add failed: ${taskAdd.stderr.slice(0, 200)}`);
  }
  const tidMatch = taskAdd.stdout.match(/added\s+task\s+(\S+)|tid[:= ]+(\S+)/i);
  const tid = tidMatch?.[1] ?? tidMatch?.[2] ?? '';
  trace('phone', `created task ${tid}: ${TASK_DESC}`);

  let resolvedTid = tid;
  if (!resolvedTid) {
    const list = await runCli(['todo', 'tasks'], PHONE_HOME);
    const found = list.stdout.match(/(\S+)\s+.*?\b(?:e2e-context-task-\d+)\b/);
    resolvedTid = found?.[1] ?? '';
  }
  if (!resolvedTid) {
    fail(`couldn't determine task id after creation; stdout was:\n${taskAdd.stdout}`);
  }
  trace('phone', `using tid ${resolvedTid}`);

  // Sync window — wait until the relay can actually see the task in
  // its own todo:tasks view before phone sends the context-tagged
  // chat message. The relay's resolveContext reads the same doc.
  await waitFor(
    async () => {
      const relayTasks = await runCli(['todo', 'tasks'], ADMIN_HOME);
      return relayTasks.status === 0 && relayTasks.stdout.includes(TASK_DESC);
    },
    {
      timeoutMs: 30_000,
      intervalMs: 1000,
      description: `task "${TASK_DESC}" replicated to relay's todo:tasks`,
    }
  );

  // Phone sends a chat message with the task as context.
  const send = await runCli(['chat', 'send', 'tell me about this task'], PHONE_HOME, {
    FAIRFOX_CHAT_SEND_CONTEXT_TASK_ID: resolvedTid,
    FAIRFOX_CHAT_SEND_CONTEXT_TASK_LABEL: TASK_DESC,
  });
  if (send.status !== 0) {
    fail(`chat send with context failed: ${send.stderr.slice(0, 200)}`);
  }
  const probeId = send.stdout.match(/wrote message (\S+)/)?.[1] ?? '';
  await waitForLine(
    relay.stdout,
    new RegExp(`\\[chat serve\\] replied to ${probeId.replace(/-/g, '\\-')}`),
    30_000,
    'relay reply'
  );

  // Echo-prompt stub: the assistant reply text IS the prompt the
  // relay built. Poll the phone's chat:main until the relay's reply
  // has replicated back to it, then assert it carries the task body.
  const reply = await waitFor(
    async () => {
      const dump = await runCli(['chat', 'dump'], PHONE_HOME);
      const start = dump.stdout.indexOf('{');
      if (start === -1) {
        return undefined;
      }
      const doc: { messages?: { sender: string; parentId?: string; text?: string }[] } = JSON.parse(
        dump.stdout.slice(start)
      );
      return doc.messages?.find((m) => m.sender === 'assistant' && m.parentId === probeId);
    },
    {
      timeoutMs: 30_000,
      intervalMs: 1000,
      description: `assistant reply for ${probeId} visible on phone`,
    }
  );
  if (!reply.text?.includes(TASK_DESC)) {
    fail(
      `prompt did not include task body. Reply text:\n${reply.text?.slice(0, 600) ?? '(empty)'}\n` +
        `Expected substring: "${TASK_DESC}"`
    );
  }
  pass(`chat prompt resolved task context: "${TASK_DESC}" appears in the prompt`);
} finally {
  await killAndWait(relay).catch(() => undefined);
}
