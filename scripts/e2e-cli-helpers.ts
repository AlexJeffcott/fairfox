// Shared infrastructure for two-or-more-CLI mesh tests.
//
// Every script under scripts/ that wants to spin up multiple
// FAIRFOX_HOME-scoped CLI subprocesses imports from here. Keeps
// each scenario file focused on the assertion, not on the
// boilerplate of spawn/kill/wait.

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dir, '..');
export const BUNDLE_PATH = resolve(REPO_ROOT, 'packages', 'cli', 'dist', 'fairfox.js');

/** Build the CLI bundle if it's missing. Idempotent — existing
 * bundle is reused so tests don't re-build on every run. */
export function buildBundleIfMissing(): void {
  if (existsSync(BUNDLE_PATH)) {
    return;
  }
  console.log('[build] building packages/cli/dist/fairfox.js');
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

export interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Run a single CLI invocation under a specific FAIRFOX_HOME and
 * collect its full stdout/stderr. Times out after 60 s by default
 * — long enough for any single CLI command, short enough that a
 * stuck call doesn't hang the test. */
export async function runCli(
  args: string[],
  home: string,
  extra: Record<string, string> = {},
  timeoutMs = 60_000
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
    }, timeoutMs);
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

export interface SubprocessHandle {
  proc: ChildProcess;
  stdout: string[];
  stderr: string[];
}

/** Spawn a long-running CLI subprocess and tee its output to this
 * test's stdout/stderr with a label prefix. Caller is responsible
 * for `killAndWait`. */
export function spawnCli(
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

export async function killAndWait(h: SubprocessHandle): Promise<void> {
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

/** Poll `chunks` (a streaming stdout/stderr buffer) for a regex
 * match. Resolves on first match, rejects on timeout. Used to gate
 * test progress on subprocess milestones (pair acks, heartbeats,
 * relay processing logs). */
export async function waitForLine(
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

export function trace(label: string, msg: string): void {
  console.log(`[${label}] ${msg}`);
}

/** Convenience: run mesh init on `adminHome` with one or more
 * invitee names, then return the share URL for a given invitee.
 * Holds the invite-open subprocess alive until `closeInvite` is
 * called by the caller (the share URL is only routable while the
 * issuer's signalling socket is open). */
export interface OpenedInvite {
  shareUrl: string;
  close: () => Promise<void>;
}

export async function bootstrapAndOpenInvite(opts: {
  adminHome: string;
  adminName: string;
  invitees: { name: string; role?: 'admin' | 'member' | 'guest' | 'llm' }[];
  inviteToOpen: string;
}): Promise<OpenedInvite> {
  const userArgs = opts.invitees.flatMap((u) => ['--user', `${u.name}:${u.role ?? 'member'}`]);
  const init = await runCli(
    ['mesh', 'init', '--admin', opts.adminName, ...userArgs],
    opts.adminHome
  );
  if (init.status !== 0) {
    throw new Error(`mesh init failed: ${init.stderr.slice(0, 200)}`);
  }
  const handle = spawnCli(
    `invite-${opts.inviteToOpen}`,
    ['mesh', 'invite', 'open', opts.inviteToOpen],
    opts.adminHome
  );
  const m = await waitForLine(
    handle.stdout,
    /(https?:\/\/\S+#pair=\S+invite=\S+)/,
    15_000,
    `share URL for ${opts.inviteToOpen}`
  );
  const shareUrl = (m[1] ?? '').replace(/[)\].,]+$/, '');
  return {
    shareUrl,
    close: async () => {
      await killAndWait(handle);
    },
  };
}

/** Pair a fresh CLI (`peerHome`) using a share URL produced by
 * `bootstrapAndOpenInvite`. Waits for the issuer's pair-ack to
 * confirm both keyrings know each other. */
export async function pairWithShare(
  peerHome: string,
  shareUrl: string,
  inviteHandle: SubprocessHandle
): Promise<void> {
  const r = await runCli(['pair', shareUrl], peerHome);
  if (r.status !== 0) {
    throw new Error(`pair failed (${peerHome}): ${r.stderr.slice(0, 200)}`);
  }
  await waitForLine(inviteHandle.stdout, /✓\s+"\S+"\s+paired/i, 30_000, 'pair ack');
}

/** Reopen an invite for the named invitee, returning a fresh
 * share URL. Used by the three-peer test where the admin opens
 * invites for two different invitees in sequence. */
export async function openExistingInvite(
  adminHome: string,
  inviteName: string,
  options: { reopen?: boolean } = {}
): Promise<OpenedInvite> {
  const args = ['mesh', 'invite', 'open', inviteName];
  if (options.reopen) {
    args.push('--reopen');
  }
  const handle = spawnCli(`invite-${inviteName}`, args, adminHome);
  const m = await waitForLine(
    handle.stdout,
    /(https?:\/\/\S+#pair=\S+invite=\S+)/,
    15_000,
    `share URL for ${inviteName}`
  );
  const shareUrl = (m[1] ?? '').replace(/[)\].,]+$/, '');
  return {
    shareUrl,
    close: async () => {
      await killAndWait(handle);
    },
  };
}

/** Generic dump helper for any chat-state JSON-emitting CLI
 * subcommand. Handles the env-probe noise that some CLI commands
 * emit before their JSON body. */
export async function jsonDump<T>(args: string[], home: string): Promise<T> {
  const r = await runCli(args, home);
  if (r.status !== 0) {
    throw new Error(`${args.join(' ')} (${home}) exited ${r.status}: ${r.stderr.slice(0, 200)}`);
  }
  const start = r.stdout.indexOf('{');
  if (start === -1) {
    throw new Error(`${args.join(' ')} (${home}) produced no JSON`);
  }
  return JSON.parse(r.stdout.slice(start)) as T;
}

export function fail(reason: string): never {
  console.error(`\nFAIL — ${reason}`);
  process.exit(1);
}

export function pass(message: string): never {
  console.log(`\nPASS — ${message}`);
  process.exit(0);
}
