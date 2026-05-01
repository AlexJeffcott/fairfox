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

const ADMIN_HOME = '/tmp/fairfox-e2e-ctx-admin';
const PHONE_HOME = '/tmp/fairfox-e2e-ctx-phone';

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

  // Sync window — let the task replicate to the relay before
  // phone sends the context-tagged chat message.
  await new Promise((r) => setTimeout(r, 6000));

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
  // relay built. Assert it contains the task description string.
  await new Promise((r) => setTimeout(r, 4000));
  const dump = await runCli(['chat', 'dump'], PHONE_HOME);
  const doc: { messages?: { sender: string; parentId?: string; text?: string }[] } = JSON.parse(
    dump.stdout.slice(dump.stdout.indexOf('{'))
  );
  const reply = doc.messages?.find((m) => m.sender === 'assistant' && m.parentId === probeId);
  if (!reply) {
    fail(`no assistant reply for ${probeId}`);
  }
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
