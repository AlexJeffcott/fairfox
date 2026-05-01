/**
 * Two-CLI mesh round-trip — proves chat actually works end-to-end
 * on one machine, against the real signalling server, with two
 * distinct FAIRFOX_HOMEs that hold separate keyrings.
 *
 * Why this script exists:
 *
 * `e2e-chat-relay.ts` writes from the same CLI that serves replies,
 * so it never exercises sync — both processes share storage. The
 * puppeteer-driven `e2e-chat-widget.ts` covers the browser surface
 * but it's expensive to spin up and the browser-side flake budget is
 * large. What we lacked was a pure CLI test that:
 *
 *   - bootstraps a real mesh on one keyring (the "laptop")
 *   - pairs a second CLI on a separate keyring (the "phone")
 *   - has the two connect through the prod signalling relay over
 *     real WebRTC, on one machine, in seconds
 *   - exercises chat send → laptop relay processing → reply
 *     → phone reads reply, with FAIRFOX_CLAUDE_STUB so no API
 *     tokens are spent
 *
 * The trick that makes it possible is FAIRFOX_HOME: each CLI
 * subprocess gets a distinct dir for its keyring, mesh storage,
 * user identity, and invites. The signalling server sees them as
 * two separate peers; WebRTC negotiates between them; Automerge
 * merges as on any real mesh.
 *
 *   bun scripts/e2e-mesh-roundtrip.ts
 *
 * Exits 0 on round-trip success, non-zero with a focused diagnostic
 * on any failure leg.
 */
// @covers: chat:main, chat:health, daemon:leader, mesh:users, mesh:devices, mesh:meta

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const BUNDLE_PATH = resolve(REPO_ROOT, 'packages', 'cli', 'dist', 'fairfox.js');
const LAPTOP_HOME = '/tmp/fairfox-e2e-roundtrip-laptop';
const PHONE_HOME = '/tmp/fairfox-e2e-roundtrip-phone';
const STUB_REPLY = 'hi from the round-trip stub';
const RELAY_READY_TIMEOUT_MS = 30_000;
const PAIR_TIMEOUT_MS = 30_000;
const ROUND_TRIP_TIMEOUT_MS = 60_000;

function trace(label: string, msg: string): void {
  console.log(`[${label}] ${msg}`);
}

function buildBundle(): void {
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
      env: {
        ...process.env,
        FAIRFOX_HOME: home,
        NODE_NO_WARNINGS: '1',
        ...extra,
      },
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
    env: {
      ...process.env,
      FAIRFOX_HOME: home,
      NODE_NO_WARNINGS: '1',
      ...extra,
    },
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
    const joined = chunks.join('');
    const match = joined.match(pattern);
    if (match) {
      return match;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label}: pattern ${pattern} did not appear within ${timeoutMs}ms`);
}

interface DumpedMessage {
  id: string;
  sender: string;
  pending: boolean;
  parentId?: string;
  text?: string;
}

async function dumpMessages(home: string): Promise<DumpedMessage[]> {
  const dump = await runCli(['chat', 'dump'], home);
  if (dump.status !== 0) {
    throw new Error(`chat dump (${home}) exited ${dump.status}: ${dump.stderr.slice(0, 200)}`);
  }
  const jsonStart = dump.stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`chat dump (${home}) produced no JSON:\n${dump.stdout.slice(0, 200)}`);
  }
  const parsed = JSON.parse(dump.stdout.slice(jsonStart));
  return Array.isArray(parsed.messages) ? parsed.messages : [];
}

// Reset both home dirs.
rmSync(LAPTOP_HOME, { recursive: true, force: true });
rmSync(PHONE_HOME, { recursive: true, force: true });
mkdirSync(LAPTOP_HOME, { recursive: true });
mkdirSync(PHONE_HOME, { recursive: true });

if (!existsSync(BUNDLE_PATH)) {
  buildBundle();
}

let inviteOpen: SubprocessHandle | undefined;
let chatServe: SubprocessHandle | undefined;
let ok = false;
let failureReason = '';

try {
  // 1. Laptop bootstraps the mesh and queues a Phone invite.
  trace('laptop', 'mesh init --admin Laptop --user Phone:member');
  const init = await runCli(
    ['mesh', 'init', '--admin', 'Laptop', '--user', 'Phone:member'],
    LAPTOP_HOME
  );
  if (init.status !== 0) {
    throw new Error(`mesh init failed: ${init.stderr.slice(0, 300)}`);
  }

  // 2. Laptop opens the invite QR (we just want the share URL printed
  //    on stdout). The process stays alive for the pair-return frame.
  trace('laptop', 'mesh invite open phone');
  inviteOpen = spawnCli('invite-open', ['mesh', 'invite', 'open', 'phone'], LAPTOP_HOME);
  const shareMatch = await waitForLine(
    inviteOpen.stdout,
    /(https?:\/\/\S+#pair=\S+invite=\S+)/,
    15_000,
    'share URL'
  );
  const shareUrlRaw = shareMatch[1] ?? '';
  const shareUrl = shareUrlRaw.replace(/[)\].,]+$/, '');
  trace('laptop', `share URL ready (${shareUrl.length} chars)`);

  // 3. Phone applies the share URL via `fairfox pair`. This drives
  //    the same accept-invite path the browser does, just from a
  //    different keyring.
  trace('phone', 'pair <share-url>');
  const phonePair = await runCli(['pair', shareUrl], PHONE_HOME);
  if (phonePair.status !== 0) {
    throw new Error(
      `phone pair failed (exit ${phonePair.status}):\n${phonePair.stderr.slice(0, 400)}`
    );
  }
  trace('phone', 'paired');

  // 4. Wait for the laptop's invite-open subprocess to log the
  //    pair-return ack, confirming both sides see each other.
  await waitForLine(inviteOpen.stdout, /✓\s+"phone"\s+paired/i, PAIR_TIMEOUT_MS, 'pair ack');
  trace('laptop', 'pair ack received');
  await killAndWait(inviteOpen);
  inviteOpen = undefined;

  // 5. Laptop starts chat serve with the stub.
  trace('laptop', 'chat serve --stub');
  chatServe = spawnCli('chat-serve', ['chat', 'serve'], LAPTOP_HOME, {
    FAIRFOX_CLAUDE_STUB: STUB_REPLY,
  });
  await waitForLine(
    chatServe.stdout,
    /\[chat serve\] chat:main loaded/,
    RELAY_READY_TIMEOUT_MS,
    'chat serve ready'
  );

  // Give the relay's mesh client a moment to pair with the phone
  // over WebRTC before the phone writes. The first sync handshake
  // is async — without this slack, the phone's chat:main write
  // can land before the relay's repo has subscribed to the doc.
  await new Promise((r) => setTimeout(r, 5000));

  // 6. Phone sends a probe. This is the actual round-trip.
  const probeText = `roundtrip ${new Date().toISOString().slice(11, 19)}`;
  trace('phone', `chat send "${probeText}"`);
  const send = await runCli(['chat', 'send', probeText], PHONE_HOME);
  if (send.status !== 0) {
    throw new Error(`phone chat send failed: ${send.stderr.slice(0, 400)}`);
  }
  const idMatch = send.stdout.match(/wrote message (\S+) in chat (\S+)/);
  if (!idMatch) {
    throw new Error(`unexpected chat send output: ${send.stdout.slice(0, 200)}`);
  }
  const probeId = idMatch[1] ?? '';
  trace('phone', `probe id ${probeId}`);

  // 7. Wait for the laptop's relay to log "[chat serve] processing"
  //    AND "[chat serve] replied to <probeId>". This is the proof
  //    that sync flowed phone → laptop.
  await waitForLine(
    chatServe.stdout,
    /\[chat serve\] processing/,
    ROUND_TRIP_TIMEOUT_MS,
    'relay processing'
  );
  trace('laptop', 'relay picked up the pending');
  await waitForLine(
    chatServe.stdout,
    new RegExp(`\\[chat serve\\] replied to ${probeId.replace(/[-]/g, '\\-')}`),
    ROUND_TRIP_TIMEOUT_MS,
    'relay reply'
  );
  trace('laptop', 'relay replied');

  // 8. Phone reads the reply via chat dump. This is the proof that
  //    sync flowed laptop → phone.
  const deadline = Date.now() + ROUND_TRIP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const messages = await dumpMessages(PHONE_HOME);
    const reply = messages.find((m) => m.sender === 'assistant' && m.parentId === probeId);
    if (reply) {
      trace('phone', `assistant reply seen (${reply.text?.slice(0, 80) ?? ''})`);
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!ok) {
    failureReason = `phone never saw the assistant reply for probe ${probeId}`;
  }
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
  console.log('\nPASS — two-CLI round-trip completed end-to-end');
  process.exit(0);
} else {
  console.error(`\nFAIL — ${failureReason}`);
  process.exit(1);
}
