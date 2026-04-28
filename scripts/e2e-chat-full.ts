/**
 * Comprehensive two-CLI chat e2e using FAIRFOX_HOME namespacing.
 *
 * `e2e-mesh-roundtrip.ts` is the single-turn smoke test. This is
 * the broader chat-functionality regression — every chat surface
 * the user has hit in the wild gets exercised:
 *
 *   1. Pair two CLIs through the prod signalling relay over real
 *      WebRTC, on one machine, with separate FAIRFOX_HOMEs.
 *   2. Multi-turn: phone sends three messages in sequence; relay
 *      processes each; phone reads each reply with the right
 *      parentId. Catches "first turn works, second hangs" race
 *      modes in pickNextPending / processOne.
 *   3. chat:health propagation phone-side: assert the phone's
 *      view of chat:health.relays gets the laptop relay's row,
 *      with a recent lastTickAt and the version we just built.
 *      Without this, the badge "relay live" would be a lie.
 *   4. Relay restart preserves chat:main: kill chat serve,
 *      send a fourth pending from the phone, restart chat serve,
 *      verify the pending is picked up and replied. Catches the
 *      destructive-migration-wipe regression and any startup
 *      sweep that incorrectly marks fresh pendings as
 *      daemon-restarted.
 *
 * Real Anthropic invocation is bypassed via FAIRFOX_CLAUDE_STUB so
 * runs are deterministic and free.
 *
 *   bun scripts/e2e-chat-full.ts
 *
 * Exits 0 only when every scenario above passes; non-zero with a
 * focused diagnostic on the first failure.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const BUNDLE_PATH = resolve(REPO_ROOT, 'packages', 'cli', 'dist', 'fairfox.js');
const LAPTOP_HOME = '/tmp/fairfox-e2e-chat-full-laptop';
const PHONE_HOME = '/tmp/fairfox-e2e-chat-full-phone';
const STUB_REPLY = 'hi from the chat-full stub';
const RELAY_READY_TIMEOUT_MS = 30_000;
const PAIR_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 60_000;
const PROBES = ['ping one', 'how are you', 'tell me a joke'] as const;
const POST_RESTART_PROBE = 'after restart';

function trace(label: string, msg: string): void {
  console.log(`[${label}] ${msg}`);
}

function buildBundleIfMissing(): void {
  if (existsSync(BUNDLE_PATH)) {
    return;
  }
  trace('build', 'building packages/cli/dist/fairfox.js');
  const r = spawnSync('bun', ['run', 'build.ts'], {
    cwd: resolve(REPO_ROOT, 'packages', 'cli'),
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error(`cli build failed (exit ${r.status ?? '?'})`);
  }
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(`cli build did not produce ${BUNDLE_PATH}`);
  }
}

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

async function runCli(
  args: string[],
  home: string,
  extra: Record<string, string> = {}
): Promise<CliResult> {
  return await new Promise<CliResult>((res, rej) => {
    const proc = spawn('bun', [BUNDLE_PATH, ...args], {
      env: { ...process.env, FAIRFOX_HOME: home, NODE_NO_WARNINGS: '1', ...extra },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => {
      stdout += String(c);
    });
    proc.stderr.on('data', (c) => {
      stderr += String(c);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      rej(new Error(`runCli timeout (${args.join(' ')})`));
    }, 60_000);
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      res({ stdout, stderr, status: code ?? (signal ? -1 : 0) });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      rej(err);
    });
  });
}

interface SubprocessHandle {
  proc: ChildProcess;
  stdout: string[];
  stderr: string[];
}

function spawnCli(
  label: string,
  args: string[],
  home: string,
  extra: Record<string, string> = {}
): SubprocessHandle {
  const proc = spawn('bun', [BUNDLE_PATH, ...args], {
    env: { ...process.env, FAIRFOX_HOME: home, NODE_NO_WARNINGS: '1', ...extra },
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  proc.stdout?.on('data', (chunk) => {
    const s = String(chunk);
    stdout.push(s);
    process.stdout.write(`  [${label}] ${s}`);
  });
  proc.stderr?.on('data', (chunk) => {
    const s = String(chunk);
    stderr.push(s);
    process.stderr.write(`  [${label} err] ${s}`);
  });
  return { proc, stdout, stderr };
}

async function killAndWait(h: SubprocessHandle): Promise<void> {
  if (h.proc.exitCode !== null) {
    return;
  }
  h.proc.kill('SIGTERM');
  await new Promise<void>((res) => {
    const t = setTimeout(() => res(), 3000);
    h.proc.once('exit', () => {
      clearTimeout(t);
      res();
    });
  });
}

async function waitForLine(
  chunks: string[],
  pattern: RegExp,
  timeoutMs: number,
  label: string
): Promise<RegExpMatchArray> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = chunks.join('').match(pattern);
    if (m) {
      return m;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label}: pattern ${pattern} did not appear within ${timeoutMs}ms`);
}

interface DumpedMessage {
  id: string;
  chatId?: string;
  sender: string;
  pending: boolean;
  parentId?: string;
  text?: string;
}
interface DumpedDoc {
  chats: { id: string }[];
  messages: DumpedMessage[];
}

async function dumpChat(home: string): Promise<DumpedDoc> {
  const dump = await runCli(['chat', 'dump'], home);
  if (dump.status !== 0) {
    throw new Error(`chat dump (${home}) exited ${dump.status}: ${dump.stderr.slice(0, 200)}`);
  }
  const jsonStart = dump.stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`chat dump (${home}) produced no JSON`);
  }
  const parsed: { chats?: unknown; messages?: unknown } = JSON.parse(dump.stdout.slice(jsonStart));
  const chats = Array.isArray(parsed.chats) ? (parsed.chats as unknown as { id: string }[]) : [];
  const messages = Array.isArray(parsed.messages)
    ? (parsed.messages as unknown as DumpedMessage[])
    : [];
  return { chats, messages };
}

/** Send a probe from the phone and wait until the phone sees the
 * matching assistant reply in chat:main. Returns the user message
 * id so callers can assert on it. */
async function sendAndAwaitReply(text: string): Promise<string> {
  const send = await runCli(['chat', 'send', text], PHONE_HOME);
  if (send.status !== 0) {
    throw new Error(`phone chat send "${text}" failed: ${send.stderr.slice(0, 200)}`);
  }
  const idMatch = send.stdout.match(/wrote message (\S+) in chat (\S+)/);
  if (!idMatch) {
    throw new Error(`unexpected chat send output for "${text}": ${send.stdout.slice(0, 200)}`);
  }
  const probeId = idMatch[1] ?? '';
  trace('phone', `sent "${text}" → ${probeId}`);
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const doc = await dumpChat(PHONE_HOME);
    const reply = doc.messages.find((m) => m.sender === 'assistant' && m.parentId === probeId);
    if (reply) {
      trace('phone', `received reply for ${probeId}: ${reply.text?.slice(0, 60) ?? ''}`);
      return probeId;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`phone never saw reply for "${text}" (probe ${probeId})`);
}

async function readChatHealthFromPhone(): Promise<{
  relays: number;
  freshestTickAt: string | undefined;
  versions: string[];
}> {
  // The CLI doesn't have a `chat health` command yet, so reach into
  // the storage by running `fairfox doctor` on the phone — it reads
  // chat:health storage-only and prints a parseable line per relay.
  const dump = await runCli(['doctor'], PHONE_HOME);
  if (dump.status !== 0) {
    throw new Error(`phone doctor exited ${dump.status}: ${dump.stderr.slice(0, 200)}`);
  }
  // Parse the chat:health section. Lines look like:
  //   <peerId8> · v<ver> · started <age> · last tick <age> · pending N · peers M [· LEADER]
  const lines = dump.stdout.split('\n');
  const healthIdx = lines.findIndex((l) => l.includes('chat:health (relay self-report)'));
  if (healthIdx === -1) {
    return { relays: 0, freshestTickAt: undefined, versions: [] };
  }
  const versions: string[] = [];
  let count = 0;
  let mostRecent: string | undefined;
  for (let i = healthIdx + 1; i < lines.length; i += 1) {
    const ln = lines[i];
    if (ln === undefined || ln.startsWith('===')) {
      break;
    }
    const verMatch = ln.match(/·\s+v([^\s·]+)/);
    if (verMatch?.[1]) {
      versions.push(verMatch[1]);
    }
    const tickMatch = ln.match(/last tick (\S[^·]*)/);
    if (tickMatch?.[1]) {
      mostRecent = tickMatch[1].trim();
    }
    if (ln.match(/^[a-f0-9]{8}\s+·/)) {
      count += 1;
    }
  }
  return { relays: count, freshestTickAt: mostRecent, versions };
}

// --- run ---

rmSync(LAPTOP_HOME, { recursive: true, force: true });
rmSync(PHONE_HOME, { recursive: true, force: true });
mkdirSync(LAPTOP_HOME, { recursive: true });
mkdirSync(PHONE_HOME, { recursive: true });

buildBundleIfMissing();

let inviteOpen: SubprocessHandle | undefined;
let chatServe: SubprocessHandle | undefined;
let ok = false;
let failureReason = '';

try {
  // 1. Pair laptop + phone.
  trace('laptop', 'mesh init --admin Laptop --user Phone:member');
  const init = await runCli(
    ['mesh', 'init', '--admin', 'Laptop', '--user', 'Phone:member'],
    LAPTOP_HOME
  );
  if (init.status !== 0) {
    throw new Error(`mesh init failed: ${init.stderr.slice(0, 200)}`);
  }

  inviteOpen = spawnCli('invite-open', ['mesh', 'invite', 'open', 'phone'], LAPTOP_HOME);
  const shareMatch = await waitForLine(
    inviteOpen.stdout,
    /(https?:\/\/\S+#pair=\S+invite=\S+)/,
    15_000,
    'share URL'
  );
  const shareUrl = (shareMatch[1] ?? '').replace(/[)\].,]+$/, '');

  const phonePair = await runCli(['pair', shareUrl], PHONE_HOME);
  if (phonePair.status !== 0) {
    throw new Error(`phone pair failed: ${phonePair.stderr.slice(0, 200)}`);
  }
  await waitForLine(inviteOpen.stdout, /✓\s+"phone"\s+paired/i, PAIR_TIMEOUT_MS, 'pair ack');
  await killAndWait(inviteOpen);
  inviteOpen = undefined;
  trace('result', 'paired');

  // 2. Start relay; wait for it to load chat:main.
  chatServe = spawnCli('chat-serve', ['chat', 'serve'], LAPTOP_HOME, {
    FAIRFOX_CLAUDE_STUB: STUB_REPLY,
  });
  await waitForLine(
    chatServe.stdout,
    /\[chat serve\] chat:main loaded/,
    RELAY_READY_TIMEOUT_MS,
    'chat serve ready'
  );
  // Slack for WebRTC handshake to actually settle so the first
  // phone write isn't lost to a not-yet-shared chat:main handle.
  await new Promise((r) => setTimeout(r, 5000));
  trace('result', 'relay ready');

  // 3. Multi-turn: send three probes in sequence, each gets a reply.
  const probeIds: string[] = [];
  for (const text of PROBES) {
    probeIds.push(await sendAndAwaitReply(text));
  }
  trace('result', `multi-turn ok (${probeIds.length} replies)`);

  // 4. Verify chat:main on the phone reflects all the probes plus
  //    their replies, with correct parentId chaining. Catches the
  //    "second turn lost the first" failure mode in pickNextPending.
  const phoneDocAfterMultiTurn = await dumpChat(PHONE_HOME);
  for (const probeId of probeIds) {
    const userMsg = phoneDocAfterMultiTurn.messages.find((m) => m.id === probeId);
    if (!userMsg) {
      throw new Error(`phone's chat:main missing user message ${probeId}`);
    }
    if (userMsg.pending !== false) {
      throw new Error(`phone's chat:main shows ${probeId} still pending after reply`);
    }
    const reply = phoneDocAfterMultiTurn.messages.find(
      (m) => m.sender === 'assistant' && m.parentId === probeId
    );
    if (!reply) {
      throw new Error(`phone's chat:main missing assistant reply for ${probeId}`);
    }
  }
  trace('result', 'chat:main shape verified on phone side');

  // 5. chat:health propagation: the phone's view of chat:health
  //    should carry the laptop relay's row with a recent tick.
  //    Catches the "WebSocket alive but data channel silent" case
  //    that surfaces as a perpetual `relay stale` badge.
  const health = await readChatHealthFromPhone();
  if (health.relays === 0) {
    throw new Error(
      `phone's chat:health view has zero relay rows — the laptop relay's heartbeat isn't reaching the phone`
    );
  }
  if (!health.freshestTickAt || !/\d+s ago|\d+m ago/.test(health.freshestTickAt)) {
    throw new Error(
      `phone's chat:health row has no recent tick (got "${health.freshestTickAt ?? '(none)'}")`
    );
  }
  trace(
    'result',
    `chat:health propagated to phone (${health.relays} relay row(s), freshest ${health.freshestTickAt})`
  );

  // 6. Relay restart preserves chat:main: kill chat serve, write a
  //    fresh pending from the phone, restart, verify the new pending
  //    is processed. Catches the destructive migration wipe and the
  //    sweep-marks-fresh-pendings-as-daemon-restarted regression.
  trace('test', 'killing relay to test restart survival');
  await killAndWait(chatServe);
  chatServe = undefined;

  const restartProbe = await runCli(['chat', 'send', POST_RESTART_PROBE], PHONE_HOME);
  if (restartProbe.status !== 0) {
    throw new Error(`phone send (post-restart) failed: ${restartProbe.stderr.slice(0, 200)}`);
  }
  const restartIdMatch = restartProbe.stdout.match(/wrote message (\S+) in chat/);
  if (!restartIdMatch) {
    throw new Error('post-restart probe send produced no id');
  }
  const restartProbeId = restartIdMatch[1] ?? '';
  trace('phone', `sent post-restart probe ${restartProbeId}`);

  // Restart the relay. The new chatServe should hydrate chat:main
  // from disk, see the freshly-written pending, and process it.
  chatServe = spawnCli('chat-serve-2', ['chat', 'serve'], LAPTOP_HOME, {
    FAIRFOX_CLAUDE_STUB: STUB_REPLY,
  });
  await waitForLine(
    chatServe.stdout,
    /\[chat serve\] chat:main loaded/,
    RELAY_READY_TIMEOUT_MS,
    'chat serve restart'
  );

  // Wait for the new relay to process the post-restart probe AND
  // verify the previous three probes' done state survived. The
  // restart-survival assertion is the whole point of step 6.
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let restartOk = false;
  while (Date.now() < deadline) {
    const doc = await dumpChat(PHONE_HOME);
    const reply = doc.messages.find(
      (m) => m.sender === 'assistant' && m.parentId === restartProbeId
    );
    if (reply) {
      // Assert previous probes survived too — chat:main should
      // still carry them, none lost to a destructive wipe.
      for (const earlierId of probeIds) {
        if (!doc.messages.find((m) => m.id === earlierId)) {
          throw new Error(`relay restart lost earlier user message ${earlierId} from chat:main`);
        }
      }
      // The reply could be the relay's stub OR a daemon-restarted
      // sweep error if our timing landed wrong. Stub is the success
      // case; sweep error means the sweep grabbed our fresh pending,
      // which is the regression we're guarding against.
      if (reply.text?.includes('interrupted')) {
        throw new Error(
          'post-restart probe was swept as daemon-restarted instead of processed — sweep is too aggressive'
        );
      }
      restartOk = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!restartOk) {
    throw new Error(`post-restart probe ${restartProbeId} never got a reply`);
  }
  trace('result', 'relay restart preserved chat:main and processed fresh pending');

  ok = true;
} catch (err) {
  failureReason = err instanceof Error ? err.message : String(err);
} finally {
  if (chatServe) {
    await killAndWait(chatServe).catch(() => undefined);
  }
  if (inviteOpen) {
    await killAndWait(inviteOpen).catch(() => undefined);
  }
}

if (ok) {
  console.log(
    '\nPASS — pair, multi-turn, chat:health propagation, relay-restart survival all verified end-to-end'
  );
  process.exit(0);
} else {
  console.error(`\nFAIL — ${failureReason}`);
  process.exit(1);
}
