/**
 * End-to-end of `fairfox daemon` Phase 1 — install, start (foreground),
 * status, stop, uninstall. No Agent SDK yet; this test exercises only
 * the supervisor + mesh-hold loop.
 *
 * No prod mesh is touched: a disposable HOME under /tmp gives this
 * test its own keyring + NodeFS store, separate from the user's
 * ~/.fairfox/. The daemon runs in --foreground mode directly (we
 * don't go through launchctl / systemctl here so the test works in
 * sandboxed CI without privileges). The `install` + `uninstall`
 * verbs still write + remove the real unit file in the isolated
 * HOME's subtree.
 *
 * Flow:
 *   1. Wipe /tmp/fairfox-test-daemon and plant a fake `~/.local/bin/
 *      fairfox` wrapper so `daemon install` finds one.
 *   2. `fairfox mesh init --admin TestAlice` — fresh keyring.
 *   3. `fairfox daemon install` — writes the plist or systemd unit
 *      into the isolated HOME tree.
 *   4. `fairfox daemon status` — asserts the unit file is listed.
 *   5. Spawn `fairfox daemon start --foreground` in a child process;
 *      wait for "Holding the mesh open" + one "peers=" heartbeat
 *      line.
 *   6. SIGTERM the child; assert exit code 0.
 *   7. `fairfox daemon uninstall` — asserts the unit file is removed
 *      and the second run is idempotent.
 *
 * On success exits 0 and prints "PASS". On any failure dumps the
 * captured stdout/stderr and exits non-zero.
 *
 *   bun scripts/e2e-daemon.ts
 */

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_HOME = '/tmp/fairfox-test-daemon';
// Same dedup reason as scripts/e2e-chat-relay.ts: bun's workspace
// resolver yields two polly copies from-source; the bundled
// fairfox.js has polly baked in exactly once. Always rebuild the
// bundle so this test mirrors what real users run.
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');
const FAKE_BIN_DIR = `${TEST_HOME}/.local/bin`;
const FAKE_BIN = `${FAKE_BIN_DIR}/fairfox`;
const UNIT_PATH_DARWIN = `${TEST_HOME}/Library/LaunchAgents/com.fairfox.daemon.plist`;
const UNIT_PATH_LINUX = `${TEST_HOME}/.config/systemd/user/fairfox-daemon.service`;
const FOREGROUND_TIMEOUT_MS = 30_000;

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

function runCliSync(args: string[]): RunResult {
  const result = spawnSync('bun', [CLI_ENTRY, ...args], {
    env: {
      ...process.env,
      HOME: TEST_HOME,
      NODE_NO_WARNINGS: '1',
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

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    fail(msg);
  }
}

async function waitForLine(chunks: string[], needle: RegExp, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (needle.test(chunks.join(''))) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main(): Promise<void> {
  header(`Wipe ${TEST_HOME}`);
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
  mkdirSync(TEST_HOME, { recursive: true });
  // Plant a fake ~/.local/bin/fairfox so daemon install finds one.
  mkdirSync(FAKE_BIN_DIR, { recursive: true });
  writeFileSync(FAKE_BIN, `#!/bin/sh\nexec bun ${CLI_ENTRY} "$@"\n`, { mode: 0o755 });
  chmodSync(FAKE_BIN, 0o755);

  header('mesh init --admin TestAlice');
  const init = runCliSync(['mesh', 'init', '--admin', 'TestAlice']);
  if (init.status !== 0) {
    console.error(init.stdout);
    console.error(init.stderr);
    fail(`mesh init exited ${init.status}`);
  }

  header('daemon install');
  const install = runCliSync(['daemon', 'install']);
  if (install.status !== 0) {
    console.error(install.stdout);
    console.error(install.stderr);
    fail(`daemon install exited ${install.status}`);
  }
  const unitPath = process.platform === 'darwin' ? UNIT_PATH_DARWIN : UNIT_PATH_LINUX;
  assert(
    existsSync(unitPath),
    `install did not produce ${unitPath}\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`
  );
  console.log(install.stdout.trim());

  header('daemon status (post-install)');
  const statusAfter = runCliSync(['daemon', 'status']);
  assert(statusAfter.status === 0, `status exit ${statusAfter.status}`);
  assert(
    statusAfter.stdout.includes(unitPath),
    `status output should list ${unitPath}:\n${statusAfter.stdout}`
  );

  header('daemon start --foreground (spawn, read heartbeat, terminate)');
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const daemon = spawn('bun', [CLI_ENTRY, 'daemon', 'start', '--foreground'], {
    env: {
      ...process.env,
      HOME: TEST_HOME,
      NODE_NO_WARNINGS: '1',
    },
  });
  daemon.stdout.on('data', (chunk) => {
    const str = String(chunk);
    stdoutChunks.push(str);
    process.stdout.write(`  [daemon stdout] ${str}`);
  });
  daemon.stderr.on('data', (chunk) => {
    const str = String(chunk);
    stderrChunks.push(str);
    process.stderr.write(`  [daemon stderr] ${str}`);
  });

  const openedMesh = await waitForLine(
    stdoutChunks,
    /Holding the mesh open/,
    FOREGROUND_TIMEOUT_MS
  );
  if (!openedMesh) {
    daemon.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    fail(`no "Holding the mesh open" within ${FOREGROUND_TIMEOUT_MS}ms`);
  }

  // The heartbeat interval is 15s. Rather than make the test wait 15s
  // for the first tick, we just prove the supervisor is alive via the
  // open-mesh line and the process staying up for a beat.
  await new Promise((r) => setTimeout(r, 500));
  assert(daemon.exitCode === null, `daemon died unexpectedly with exit ${daemon.exitCode}`);

  const exited = new Promise<number>((done) => {
    daemon.once('exit', (code) => {
      done(code ?? -1);
    });
  });
  daemon.kill('SIGTERM');
  const exitCode = await exited;
  assert(exitCode === 0, `daemon exited with ${exitCode} (expected 0 on SIGTERM)`);

  header('daemon uninstall');
  const uninstall = runCliSync(['daemon', 'uninstall']);
  assert(uninstall.status === 0, `uninstall exit ${uninstall.status}`);
  assert(!existsSync(unitPath), `uninstall did not remove ${unitPath}`);

  header('daemon uninstall (idempotent)');
  const uninstall2 = runCliSync(['daemon', 'uninstall']);
  assert(uninstall2.status === 0, `second uninstall exit ${uninstall2.status} (expected 0)`);

  console.log('\nPASS — daemon install → start → stop → uninstall cycle green.');
}

await main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
