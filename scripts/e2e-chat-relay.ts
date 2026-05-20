/**
 * End-to-end of the chat relay's pending → reply → clear loop, plus
 * per-chat Claude session continuity.
 *
 * No prod mesh is touched: a disposable HOME dir under /tmp gives
 * this test its own keyring + NodeFS store, separate from the
 * user's ~/.fairfox/. Claude is stubbed via FAIRFOX_CLAUDE_STUB so
 * no API tokens are spent; the point of the test is the plumbing
 * between sub-app write and relay write, not the LLM call itself.
 *
 * Phase 1 — pending → reply → clear:
 *   1. Wipe and create an isolated HOME at /tmp/fairfox-test-chat.
 *   2. `fairfox mesh init --admin TestAlice`.
 *   3. `fairfox chat send "hello"` — writes a pending user message.
 *   4. Run `fairfox chat serve` (stubbed) until it logs a reply.
 *   5. `fairfox chat dump` — assert 1 chat / 2 messages, the reply
 *      parents the user message, the pending flag cleared, and the
 *      chat picked up a `claudeSessionId` from a NEW session.
 *
 * Phase 2 — session resume:
 *   6. `fairfox chat send --chat <id> "second question"` — a second
 *      message into the SAME chat.
 *   7. Run a fresh `fairfox chat serve` until it logs a reply.
 *   8. Assert the relay logged `resuming session <id>` (NOT a new
 *      session), the chat's `claudeSessionId` is unchanged, and the
 *      second reply parents the second user message.
 *
 * Phase 2 deliberately uses a second relay process: the session id
 * has to round-trip through the mesh doc and NodeFS storage and be
 * resumed by a relay that never held it in memory — that is the
 * real-world path (laptop relay restarts, phone keeps chatting).
 *
 * On success exits 0 and prints "PASS"; on any failure dumps the
 * full chat:main state and exits non-zero.
 *
 *   bun scripts/e2e-chat-relay.ts
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_HOME = '/tmp/fairfox-test-chat';
// Running the CLI via `bun packages/cli/src/bin.ts` fails under
// `mesh init` because bun's workspace resolution produces two copies
// of @fairfox/polly in node_modules — one used by cli/mesh.ts, a
// different one used by shared/devices-state. configureMeshState
// only reaches its own polly copy, so shared's $meshState then
// throws "no Repo configured". The bundled fairfox.js has polly
// baked in exactly once, matching what prod uses, so always rebuild
// it fresh for the test.
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');
const STUB_REPLY = 'hi human — ack from the stub';
const RELAY_TIMEOUT_MS = 45_000;

function buildBundle(): string {
  console.log('(building packages/cli/dist/fairfox.js)');
  const build = spawnSync('bun', ['run', 'build.ts'], {
    cwd: resolve(import.meta.dir, '..', 'packages', 'cli'),
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    throw new Error(`cli build failed (exit ${build.status ?? '?'})`);
  }
  if (!existsSync(BUILT_BUNDLE)) {
    throw new Error(`cli build did not produce ${BUILT_BUNDLE}`);
  }
  return BUILT_BUNDLE;
}

const CLI_ENTRY = buildBundle();

function header(msg: string): void {
  console.log(`\n=== ${msg}`);
}

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runCliSync(args: string[], extraEnv: Record<string, string> = {}): RunResult {
  const result = spawnSync('bun', [CLI_ENTRY, ...args], {
    env: {
      ...process.env,
      HOME: TEST_HOME,
      NODE_NO_WARNINGS: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

function fail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

async function waitForRelayReply(
  stdoutChunks: string[],
  timeoutMs: number
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const joined = stdoutChunks.join('');
    const match = joined.match(/\[chat serve\] replied to ([\w-]+)/);
    if (match) {
      return match[1] ?? null;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

interface RelayRun {
  stdout: string;
  replyTargetId: string;
}

/** Spawn a stubbed `fairfox chat serve`, wait until it logs one
 * reply, let the CRDT/sync flush settle, then kill it. Returns the
 * relay's full stdout so the caller can assert on the resume log. */
async function runRelayUntilReply(): Promise<RelayRun> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const relay = spawn('bun', [CLI_ENTRY, 'chat', 'serve'], {
    env: {
      ...process.env,
      HOME: TEST_HOME,
      NODE_NO_WARNINGS: '1',
      FAIRFOX_CLAUDE_STUB: STUB_REPLY,
    },
  });
  relay.stdout.on('data', (chunk) => {
    const str = String(chunk);
    stdoutChunks.push(str);
    process.stdout.write(`  [relay stdout] ${str}`);
  });
  relay.stderr.on('data', (chunk) => {
    const str = String(chunk);
    stderrChunks.push(str);
    process.stderr.write(`  [relay stderr] ${str}`);
  });

  const replyTargetId = await waitForRelayReply(stdoutChunks, RELAY_TIMEOUT_MS);
  if (!replyTargetId) {
    relay.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    fail(`no "[chat serve] replied to …" within ${RELAY_TIMEOUT_MS}ms`);
  }
  console.log(`relay acknowledged reply to ${replyTargetId}`);

  // Let the outgoing sync + CRDT flush settle before closing.
  await new Promise((r) => setTimeout(r, 2000));
  relay.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  return { stdout: stdoutChunks.join(''), replyTargetId };
}

interface DumpState {
  chats: Record<string, unknown>[];
  messages: Record<string, unknown>[];
}

function dumpChat(): DumpState {
  const dump = runCliSync(['chat', 'dump']);
  if (dump.status !== 0) {
    console.error(dump.stdout);
    console.error(dump.stderr);
    fail(`chat dump exited ${dump.status}`);
  }
  // The dump prints some env-probe noise on the first line; find
  // the JSON body.
  const jsonStart = dump.stdout.indexOf('{');
  if (jsonStart === -1) {
    fail(`chat dump produced no JSON:\n${dump.stdout}`);
  }
  const parsed = JSON.parse(dump.stdout.slice(jsonStart));
  return {
    chats: Array.isArray(parsed.chats) ? parsed.chats : [],
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
  };
}

/** Parse `wrote message <id> in chat <id>` from `chat send`. */
function parseSend(stdout: string): { messageId: string; chatId: string } {
  const m = stdout.match(/wrote message (\S+) in chat (\S+)/);
  const messageId = m?.[1];
  const chatId = m?.[2];
  if (messageId === undefined || chatId === undefined) {
    fail(`chat send output not recognised: "${stdout.trim()}"`);
  }
  return { messageId, chatId };
}

function assistantReplyTo(state: DumpState, userMessageId: string): Record<string, unknown> {
  const reply = state.messages.find(
    (m) => m.sender === 'assistant' && m.parentId === userMessageId
  );
  if (!reply) {
    console.error(JSON.stringify(state, null, 2));
    fail(`no assistant reply parenting user message ${userMessageId}`);
  }
  return reply;
}

function userMessage(state: DumpState, messageId: string): Record<string, unknown> {
  const msg = state.messages.find((m) => m.id === messageId);
  if (!msg) {
    console.error(JSON.stringify(state, null, 2));
    fail(`user message ${messageId} missing from dump`);
  }
  return msg;
}

async function main(): Promise<void> {
  header(`Wipe ${TEST_HOME}`);
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
  mkdirSync(TEST_HOME, { recursive: true });

  header('mesh init --admin TestAlice');
  const init = runCliSync(['init', '--admin', 'TestAlice']);
  if (init.status !== 0) {
    console.error(init.stdout);
    console.error(init.stderr);
    fail(`mesh init exited ${init.status}`);
  }
  console.log(init.stdout.split('\n').slice(-5).join('\n'));

  // ── Phase 1 — pending → reply → clear, new session ──────────────
  header('Phase 1 — chat send "hello"');
  const send1 = runCliSync(['chat', 'send', 'hello']);
  if (send1.status !== 0) {
    console.error(send1.stdout);
    console.error(send1.stderr);
    fail(`chat send exited ${send1.status}`);
  }
  console.log(send1.stdout.trim());
  const first = parseSend(send1.stdout);

  header(`Phase 1 — chat serve (stub=${STUB_REPLY})`);
  const relay1 = await runRelayUntilReply();
  if (!relay1.stdout.includes('— new session')) {
    console.error(relay1.stdout);
    fail('phase 1 relay did not log "— new session" for the first message');
  }

  header('Phase 1 — chat dump, verify reply + session id');
  const state1 = dumpChat();
  if (state1.chats.length !== 1) {
    console.error(JSON.stringify(state1, null, 2));
    fail(`expected 1 chat after phase 1, got ${state1.chats.length}`);
  }
  if (state1.messages.length !== 2) {
    console.error(JSON.stringify(state1, null, 2));
    fail(`expected 2 messages after phase 1, got ${state1.messages.length}`);
  }
  const user1 = userMessage(state1, first.messageId);
  if (user1.pending !== false) {
    fail(`phase 1 user message still pending=${String(user1.pending)} after relay finished`);
  }
  const reply1 = assistantReplyTo(state1, first.messageId);
  if (!String(reply1.text).includes('hi human')) {
    fail(`phase 1 assistant text "${String(reply1.text)}" doesn't look like the stub reply`);
  }
  const chat1 = state1.chats[0] ?? {};
  const sessionId = chat1.claudeSessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    console.error(JSON.stringify(state1, null, 2));
    fail(`chat has no claudeSessionId after phase 1 (got ${String(sessionId)})`);
  }
  console.log(`chat homed on Claude session ${sessionId}`);

  // ── Phase 2 — second message resumes the same session ───────────
  header(`Phase 2 — chat send --chat ${first.chatId} "second question"`);
  const send2 = runCliSync(['chat', 'send', '--chat', first.chatId, 'second question']);
  if (send2.status !== 0) {
    console.error(send2.stdout);
    console.error(send2.stderr);
    fail(`chat send --chat exited ${send2.status}`);
  }
  console.log(send2.stdout.trim());
  const second = parseSend(send2.stdout);
  if (second.chatId !== first.chatId) {
    fail(`second message landed in chat ${second.chatId}, expected ${first.chatId}`);
  }

  header('Phase 2 — chat serve, expect a resumed session');
  const relay2 = await runRelayUntilReply();
  if (!relay2.stdout.includes(`resuming session ${sessionId}`)) {
    console.error(relay2.stdout);
    fail(`phase 2 relay did not log "resuming session ${sessionId}"`);
  }
  if (relay2.stdout.includes('— new session')) {
    console.error(relay2.stdout);
    fail('phase 2 relay cold-started a new session instead of resuming');
  }

  header('Phase 2 — chat dump, verify continuity');
  const state2 = dumpChat();
  if (state2.chats.length !== 1) {
    console.error(JSON.stringify(state2, null, 2));
    fail(`expected 1 chat after phase 2, got ${state2.chats.length}`);
  }
  if (state2.messages.length !== 4) {
    console.error(JSON.stringify(state2, null, 2));
    fail(`expected 4 messages after phase 2, got ${state2.messages.length}`);
  }
  const user2 = userMessage(state2, second.messageId);
  if (user2.pending !== false) {
    fail(`phase 2 user message still pending=${String(user2.pending)} after relay finished`);
  }
  assistantReplyTo(state2, second.messageId);
  const chat2 = state2.chats[0] ?? {};
  if (chat2.claudeSessionId !== sessionId) {
    console.error(JSON.stringify(state2, null, 2));
    fail(
      `claudeSessionId changed across turns: was ${sessionId}, now ${String(chat2.claudeSessionId)}`
    );
  }

  console.log(
    `\nPASS — relay cleared both pendings; the chat kept one Claude session (${sessionId}) across two messages and two relay processes.`
  );
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
