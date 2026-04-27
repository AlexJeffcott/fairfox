/**
 * End-to-end of the chat relay's pending → reply → clear loop.
 *
 * No prod mesh is touched: a disposable HOME dir under /tmp gives
 * this test its own keyring + NodeFS store, separate from the
 * user's ~/.fairfox/. Claude is stubbed via FAIRFOX_CLAUDE_STUB so
 * no API tokens are spent; the point of the test is the plumbing
 * between sub-app write and relay write, not the LLM call itself.
 *
 * Flow:
 *   1. Wipe and create an isolated HOME at /tmp/fairfox-test-chat.
 *   2. `fairfox mesh init --admin TestAlice` — creates the keyring
 *      and admin user in the disposable HOME.
 *   3. `fairfox chat send "hello"` — writes a pending user message.
 *   4. Spawn `fairfox chat serve` with FAIRFOX_CLAUDE_STUB set.
 *   5. Wait for stdout to log "[chat serve] replied to …".
 *   6. Kill the relay.
 *   7. `fairfox chat dump` — parse JSON, assert:
 *        - 1 chat, 2 messages.
 *        - 2nd message sender=assistant, text matches the stub,
 *          parentId == the user message id, pending=false.
 *        - 1st message pending flipped to false.
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

async function main(): Promise<void> {
  header(`Wipe ${TEST_HOME}`);
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
  mkdirSync(TEST_HOME, { recursive: true });

  header('mesh init --admin TestAlice');
  const init = runCliSync(['mesh', 'init', '--admin', 'TestAlice']);
  if (init.status !== 0) {
    console.error(init.stdout);
    console.error(init.stderr);
    fail(`mesh init exited ${init.status}`);
  }
  console.log(init.stdout.split('\n').slice(-5).join('\n'));

  header('chat send "hello"');
  const send = runCliSync(['chat', 'send', 'hello']);
  if (send.status !== 0) {
    console.error(send.stdout);
    console.error(send.stderr);
    fail(`chat send exited ${send.status}`);
  }
  console.log(send.stdout.trim());

  header(`chat serve (stub=${STUB_REPLY})`);
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

  header('chat dump — verify state');
  const dump = runCliSync(['chat', 'dump']);
  if (dump.status !== 0) {
    console.error(dump.stdout);
    console.error(dump.stderr);
    fail(`chat dump exited ${dump.status}`);
  }
  // The dump also prints some env-probe noise on the first line;
  // find the JSON body.
  const jsonStart = dump.stdout.indexOf('{');
  if (jsonStart === -1) {
    fail(`chat dump produced no JSON:\n${dump.stdout}`);
  }
  const parsed = JSON.parse(dump.stdout.slice(jsonStart));
  const chats = Array.isArray(parsed.chats) ? parsed.chats : [];
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];

  if (chats.length !== 1) {
    console.error(JSON.stringify(parsed, null, 2));
    fail(`expected 1 chat, got ${chats.length}`);
  }
  if (messages.length !== 2) {
    console.error(JSON.stringify(parsed, null, 2));
    fail(`expected 2 messages, got ${messages.length}`);
  }
  const userMsg = messages.find((m: { sender: string }) => m.sender === 'user');
  const botMsg = messages.find((m: { sender: string }) => m.sender === 'assistant');
  if (!userMsg) {
    fail('no user message in dump');
  }
  if (!botMsg) {
    fail('no assistant message in dump');
  }
  if (userMsg.pending !== false) {
    fail(`user message still pending=${String(userMsg.pending)} after relay finished`);
  }
  if (botMsg.parentId !== userMsg.id) {
    fail(`assistant message parentId=${String(botMsg.parentId)} expected ${String(userMsg.id)}`);
  }
  if (!String(botMsg.text).includes('hi human')) {
    fail(`assistant text "${String(botMsg.text)}" doesn't look like the stub reply`);
  }

  console.log(
    '\nPASS — relay processed the pending message and wrote a reply with correct parentId.'
  );
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
