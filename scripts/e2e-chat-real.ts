/**
 * "Is my chat actually working right now?" — exercises the real,
 * paired mesh under $HOME/.fairfox, against the real signalling
 * relay, with the real `chat serve` daemon (must already be
 * running). Sends a pending user message via `fairfox chat send`,
 * watches the assistant reply land in chat:main, prints the
 * round-trip latency. Real Anthropic call by default — pass
 * --stub to use FAIRFOX_CLAUDE_STUB and avoid burning tokens.
 *
 * Unlike e2e-chat-widget.ts (synthetic mesh under /tmp, stubbed
 * Claude), this answers "does the user's installation work?" not
 * "does the code work?". Use this when a user reports pending-
 * forever — together with `fairfox doctor` it splits which leg of
 * the round-trip broke.
 *
 *   bun scripts/e2e-chat-real.ts              # hits real claude -p
 *   bun scripts/e2e-chat-real.ts --stub       # uses stub instead
 *
 * Exits 0 on round-trip success, non-zero on timeout.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ARGS = new Set(process.argv.slice(2));
const USE_STUB = ARGS.has('--stub');
const TIMEOUT_MS = USE_STUB ? 30_000 : 120_000;
const PROBE_TEXT = `e2e-real ${new Date().toISOString().slice(11, 19)}`;

const REPO_ROOT = resolve(import.meta.dir, '..');
const BUNDLE_PATH = resolve(REPO_ROOT, 'packages', 'cli', 'dist', 'fairfox.js');
const KEYRING_PATH = join(homedir(), '.fairfox', 'keyring.json');

if (!existsSync(KEYRING_PATH)) {
  console.error(`fail: no keyring at ${KEYRING_PATH}.`);
  console.error('Run `fairfox mesh init` or `fairfox pair <token>` first.');
  process.exit(2);
}

if (!existsSync(BUNDLE_PATH)) {
  console.log('(building packages/cli/dist/fairfox.js)');
  const build = spawnSync('bun', ['run', 'build.ts'], {
    cwd: resolve(REPO_ROOT, 'packages', 'cli'),
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    console.error(`cli build failed (exit ${build.status ?? '?'})`);
    process.exit(2);
  }
}

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  return await new Promise<CliResult>((res, rej) => {
    const proc = spawn('bun', [BUNDLE_PATH, ...args], {
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
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

interface DumpedMessage {
  id: string;
  sender: string;
  pending: boolean;
  parentId?: string;
  text?: string;
  error?: { kind: string };
}

async function dumpMessages(): Promise<DumpedMessage[]> {
  const dump = await runCli(['chat', 'dump']);
  if (dump.status !== 0) {
    throw new Error(`chat dump exited ${dump.status}: ${dump.stderr.slice(0, 200)}`);
  }
  const jsonStart = dump.stdout.indexOf('{');
  if (jsonStart === -1) {
    throw new Error(`chat dump produced no JSON:\n${dump.stdout.slice(0, 300)}`);
  }
  const parsed = JSON.parse(dump.stdout.slice(jsonStart));
  return Array.isArray(parsed.messages) ? parsed.messages : [];
}

async function main(): Promise<number> {
  if (USE_STUB) {
    console.log('mode: --stub (FAIRFOX_CLAUDE_STUB will be set when starting chat serve)');
    console.log('note: this script does NOT start chat serve. Start it yourself with:');
    console.log(`  FAIRFOX_CLAUDE_STUB="hi from stub" fairfox chat serve`);
    console.log('');
  } else {
    console.log('mode: real claude -p (sends to Anthropic, costs real money)');
  }

  // 1. Send a pending user message via the CLI. Same write path
  // the CLAUDE.md doc describes — this side proves the local CLI
  // can reach chat:main. If it succeeds, sync to the relay is
  // someone else's problem.
  console.log(`\nsending: ${PROBE_TEXT}`);
  const send = await runCli(['chat', 'send', PROBE_TEXT]);
  if (send.status !== 0) {
    console.error(`chat send failed (exit ${send.status}): ${send.stderr.slice(0, 300)}`);
    return 2;
  }
  // Extract the message id from "wrote message <id> in chat <id>".
  const idMatch = send.stdout.match(/wrote message (\S+) in chat (\S+)/);
  if (!idMatch) {
    console.error(`unexpected chat send output: ${send.stdout.slice(0, 200)}`);
    return 2;
  }
  const probeId = idMatch[1] ?? '';
  console.log(`probe id: ${probeId}`);

  // 2. Poll chat:main until the assistant message lands. The
  // relay's reply has parentId === probeId.
  console.log(`waiting up to ${TIMEOUT_MS / 1000}s for the relay to reply…`);
  const deadline = Date.now() + TIMEOUT_MS;
  const start = Date.now();
  let lastSeenPending: boolean | null = null;
  while (Date.now() < deadline) {
    let messages: DumpedMessage[] = [];
    try {
      messages = await dumpMessages();
    } catch (err) {
      console.error(`dump failed: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const probe = messages.find((m) => m.id === probeId);
    if (!probe) {
      // Migration wipe ate it, or the doc's gone.
      console.error(`probe ${probeId} disappeared from chat:main — migration wipe?`);
      return 1;
    }
    const reply = messages.find((m) => m.sender === 'assistant' && m.parentId === probeId);
    if (reply) {
      const ms = Date.now() - start;
      const status = reply.error ? `error: ${reply.error.kind}` : 'ok';
      console.log(`\nPASS — reply landed in ${ms}ms (${status})`);
      if (reply.text) {
        console.log(`text: ${reply.text.slice(0, 200)}${reply.text.length > 200 ? '…' : ''}`);
      }
      return reply.error ? 1 : 0;
    }
    if (probe.pending !== lastSeenPending) {
      lastSeenPending = probe.pending;
      console.log(`  [${Math.round((Date.now() - start) / 1000)}s] pending=${probe.pending}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Timeout — print a focused diagnostic.
  console.error(`\nFAIL — no reply within ${TIMEOUT_MS / 1000}s`);
  console.error('Run `fairfox doctor` for the full picture.');
  return 1;
}

const code = await main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  return 2;
});
process.exit(code);
