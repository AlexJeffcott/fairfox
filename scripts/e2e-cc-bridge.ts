/**
 * End-to-end of the Claude Code → fairfox mesh bridge.
 *
 * Simulates CC firing a `SessionStart` hook at the daemon by piping
 * a synthetic hook payload to `fairfox daemon hook session-start`.
 * The hook opens a short-lived mesh client, writes a
 * SessionAnnouncement into the `sessions:active` mesh doc, and
 * exits. Another CLI invocation reads the doc back via a tiny bun
 * script in the same isolated HOME and asserts the session landed.
 *
 * Flow:
 *   1. Wipe /tmp/fairfox-test-cc-bridge.
 *   2. `fairfox mesh init --admin TestAlice` — fresh keyring.
 *   3. Pipe `{session_id, cwd, transcript_path}` into
 *      `fairfox daemon hook session-start`.
 *   4. Run a helper that opens a mesh client and dumps
 *      sessions:active to JSON.
 *   5. Assert the dumped doc contains the session we just
 *      announced.
 *   6. Fire a `session-stop` hook for the same session; assert the
 *      doc no longer lists it.
 *
 *   bun scripts/e2e-cc-bridge.ts
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_HOME = '/tmp/fairfox-test-cc-bridge';
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');
const SESSION_ID = 'cc-bridge-test-session-1776000000';
const CWD = '/tmp/fairfox-test-cc-bridge/fake-repo';
const TRANSCRIPT = '/tmp/fairfox-test-cc-bridge/fake-repo/transcript.jsonl';
const DUMP_SCRIPT = '/tmp/fairfox-test-cc-bridge/dump-sessions.ts';

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

function pipeStdin(args: string[], stdin: string): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn('bun', [CLI_ENTRY, ...args], {
      env: {
        ...process.env,
        HOME: TEST_HOME,
        NODE_NO_WARNINGS: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr.on('data', (c) => {
      stderr += String(c);
    });
    child.on('close', (code) => {
      resolvePromise({ stdout, stderr, status: code ?? -1 });
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

function fail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    fail(msg);
  }
}

function writeDumpScript(): void {
  // Tiny standalone script that opens the same mesh client the daemon
  // would and dumps sessions:active as JSON. Runs from inside the
  // isolated HOME via `bun <path>` — it re-uses the fairfox bundle's
  // polly by running under Bun with import resolution against the
  // monorepo node_modules, but since we only need the mesh doc we
  // can call the CLI with a one-shot script that imports from the
  // bundled fairfox.
  writeFileSync(
    DUMP_SCRIPT,
    `import { $meshState } from '${resolve(import.meta.dir, '..', 'packages', 'shared', 'src', 'polly-reexport.ts')}';
import { SESSIONS_ACTIVE_DOC_ID } from '${resolve(import.meta.dir, '..', 'packages', 'shared', 'src', 'assistant-state.ts')}';
import { openMeshClient, derivePeerId, keyringStorage, flushOutgoing } from '${resolve(import.meta.dir, '..', 'packages', 'cli', 'src', 'mesh.ts')}';

const storage = keyringStorage();
const keyring = await storage.load();
if (!keyring) { console.error('no keyring'); process.exit(1); }
const peerId = derivePeerId(keyring.identity.publicKey);
const client = await openMeshClient({ peerId });
const s = $meshState(SESSIONS_ACTIVE_DOC_ID, { sessions: [] });
await s.loaded;
await flushOutgoing(300);
console.log(JSON.stringify(s.value, null, 2));
await client.close();
`
  );
}

async function main(): Promise<void> {
  header(`Wipe ${TEST_HOME}`);
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(CWD, { recursive: true });
  writeFileSync(TRANSCRIPT, '');
  writeDumpScript();

  header('mesh init --admin TestAlice');
  const init = runCliSync(['mesh', 'init', '--admin', 'TestAlice']);
  if (init.status !== 0) {
    console.error(init.stdout);
    console.error(init.stderr);
    fail(`mesh init exited ${init.status}`);
  }

  header('daemon hook session-start (piped synthetic CC payload)');
  const startPayload = JSON.stringify({
    hook_event_name: 'SessionStart',
    session_id: SESSION_ID,
    source: 'startup',
    cwd: CWD,
    transcript_path: TRANSCRIPT,
  });
  const startResult = await pipeStdin(['daemon', 'hook', 'session-start'], startPayload);
  if (startResult.status !== 0) {
    console.error(startResult.stdout);
    console.error(startResult.stderr);
    fail(`daemon hook session-start exited ${startResult.status}`);
  }
  console.log(startResult.stdout.trim());

  header('read sessions:active via the same mesh');
  const afterStart = spawnSync('bun', [DUMP_SCRIPT], {
    env: { ...process.env, HOME: TEST_HOME, NODE_NO_WARNINGS: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (afterStart.status !== 0) {
    console.error(afterStart.stdout);
    console.error(afterStart.stderr);
    fail(`dump exited ${afterStart.status ?? -1}`);
  }
  const afterStartJson = afterStart.stdout.trim();
  const afterStartDoc = JSON.parse(afterStartJson);
  assert(
    Array.isArray(afterStartDoc.sessions),
    `sessions:active shape wrong after start:\n${afterStartJson}`
  );
  const listed = afterStartDoc.sessions.find(
    (s: { sessionId: string }) => s.sessionId === SESSION_ID
  );
  assert(
    listed,
    `expected session ${SESSION_ID} in sessions:active after start:\n${afterStartJson}`
  );
  assert(listed.cwd === CWD, `expected cwd=${CWD}, got ${String(listed.cwd)}`);
  assert(listed.state === 'started', `expected state=started, got ${String(listed.state)}`);

  header('daemon hook prompt-submit (same session, with a preview)');
  const promptPayload = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    prompt: 'what time is it',
    cwd: CWD,
    transcript_path: TRANSCRIPT,
  });
  const promptResult = await pipeStdin(['daemon', 'hook', 'prompt-submit'], promptPayload);
  assert(promptResult.status === 0, `daemon hook prompt-submit exited ${promptResult.status}`);

  const afterPrompt = spawnSync('bun', [DUMP_SCRIPT], {
    env: { ...process.env, HOME: TEST_HOME, NODE_NO_WARNINGS: '1' },
    encoding: 'utf8',
  });
  const afterPromptDoc = JSON.parse(afterPrompt.stdout.trim());
  const listed2 = afterPromptDoc.sessions.find(
    (s: { sessionId: string }) => s.sessionId === SESSION_ID
  );
  assert(listed2, 'expected session present after prompt-submit');
  assert(
    listed2.state === 'prompt-submit',
    `expected state=prompt-submit, got ${String(listed2.state)}`
  );
  assert(
    listed2.lastPromptPreview === 'what time is it',
    `expected lastPromptPreview='what time is it', got ${String(listed2.lastPromptPreview)}`
  );

  header('daemon hook session-stop (removes session from sessions:active)');
  const stopPayload = JSON.stringify({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    transcript_path: TRANSCRIPT,
  });
  const stopResult = await pipeStdin(['daemon', 'hook', 'session-stop'], stopPayload);
  assert(stopResult.status === 0, `daemon hook session-stop exited ${stopResult.status}`);

  const afterStop = spawnSync('bun', [DUMP_SCRIPT], {
    env: { ...process.env, HOME: TEST_HOME, NODE_NO_WARNINGS: '1' },
    encoding: 'utf8',
  });
  const afterStopDoc = JSON.parse(afterStop.stdout.trim());
  const stillThere = afterStopDoc.sessions.find(
    (s: { sessionId: string }) => s.sessionId === SESSION_ID
  );
  assert(
    !stillThere,
    `expected session ${SESSION_ID} removed after session-stop, but still present:\n${afterStop.stdout}`
  );

  console.log('\nPASS — CC hook payloads round-trip through sessions:active correctly.');
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
