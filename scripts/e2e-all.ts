/**
 * Run every CLI-driven e2e in sequence and aggregate results.
 *
 * Each test is its own process (a fresh `bun scripts/e2e-X.ts`)
 * so a hang or crash in one doesn't poison the others. Output is
 * summarised at the end with PASS/FAIL/duration per test.
 *
 * Use this as the regression gate before any change touching
 * keyring, pairing, signalling, chat:main, or sub-app docs:
 *
 *   bun scripts/e2e-all.ts
 *
 * Pass `--only <name>` (matched as substring) to run a subset.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBundleIfMissing } from './e2e-cli-helpers.ts';

const ARGS = process.argv.slice(2);
const ONLY = (() => {
  const i = ARGS.indexOf('--only');
  if (i >= 0 && ARGS[i + 1]) {
    return ARGS[i + 1];
  }
  return undefined;
})();

const SCRIPTS_DIR = import.meta.dir;

interface Test {
  readonly name: string;
  readonly file: string;
  readonly timeoutMs: number;
}

// Ordered list. Keep cheap tests first so a regression surfaces
// fast.
const TESTS: readonly Test[] = [
  { name: 'agenda-concurrent', file: 'e2e-agenda-concurrent.ts', timeoutMs: 120_000 },
  { name: 'recovery-blob', file: 'e2e-recovery-blob.ts', timeoutMs: 60_000 },
  { name: 'mesh-roundtrip', file: 'e2e-mesh-roundtrip.ts', timeoutMs: 240_000 },
  { name: 'chat-archive', file: 'e2e-chat-archive.ts', timeoutMs: 180_000 },
  { name: 'chat-pinned-model', file: 'e2e-chat-pinned-model.ts', timeoutMs: 180_000 },
  { name: 'mesh-three-peer', file: 'e2e-mesh-three-peer.ts', timeoutMs: 300_000 },
  { name: 'chat-full', file: 'e2e-chat-full.ts', timeoutMs: 300_000 },
  // Currently deferred — each depends on cross-CLI-process state
  // durability that polly's NodeFS storage adapter doesn't reliably
  // provide today. Writes from one short-lived CLI process don't
  // always land on disk in time for a follow-up CLI process to read
  // them, even with `repo.flush()`, generous sleeps, and double-
  // flush patterns. The tests are correct; the underlying storage
  // behaviour needs a polly fix before they'll pass deterministically.
  // Run individually when investigating that layer:
  //
  //   - e2e-user-revocation.ts        (mesh:users entry not durable)
  //   - e2e-chat-context-task.ts      (todo:tasks entry not durable)
  //   - e2e-chat-sweep.ts             (chat:main pending sync timing)
  //   - e2e-chat-leader-lease.ts      (peers=0 between brief sends)
  //   - e2e-mesh-large-doc.ts         (bulk writes not durable to disk)
];

const filtered = ONLY ? TESTS.filter((t) => t.name.includes(ONLY)) : TESTS;
if (filtered.length === 0) {
  console.error(`no test matches --only ${ONLY ?? ''}`);
  process.exit(2);
}

buildBundleIfMissing();

interface Result {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'timeout' | 'error';
  readonly durationMs: number;
  readonly tail: string;
}

async function runOne(t: Test): Promise<Result> {
  const path = resolve(SCRIPTS_DIR, t.file);
  if (!existsSync(path)) {
    return { name: t.name, status: 'error', durationMs: 0, tail: 'script file missing' };
  }
  const t0 = Date.now();
  return await new Promise<Result>((res) => {
    const proc = spawn('bun', [path], { stdio: ['ignore', 'pipe', 'pipe'] });
    const buf: string[] = [];
    let timedOut = false;
    proc.stdout.on('data', (c) => {
      const s = String(c);
      buf.push(s);
      // Cap memory while still keeping the failure tail.
      if (buf.length > 400) {
        buf.splice(0, 100);
      }
    });
    proc.stderr.on('data', (c) => {
      buf.push(String(c));
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, t.timeoutMs);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      const tail = buf.join('').split('\n').slice(-12).join('\n');
      const durationMs = Date.now() - t0;
      if (timedOut) {
        res({ name: t.name, status: 'timeout', durationMs, tail });
      } else if (code === 0) {
        res({ name: t.name, status: 'pass', durationMs, tail });
      } else {
        res({ name: t.name, status: 'fail', durationMs, tail });
      }
    });
  });
}

const results: Result[] = [];
for (const t of filtered) {
  process.stdout.write(`▶ ${t.name} … `);
  const r = await runOne(t);
  const sec = (r.durationMs / 1000).toFixed(1);
  const marker = r.status === 'pass' ? 'PASS' : r.status.toUpperCase();
  process.stdout.write(`${marker} (${sec}s)\n`);
  if (r.status !== 'pass') {
    process.stdout.write(`${r.tail}\n`);
  }
  results.push(r);
}

const failed = results.filter((r) => r.status !== 'pass');
console.log(
  `\n${results.length - failed.length}/${results.length} passed in ${(results.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(1)}s total`
);
if (failed.length > 0) {
  console.log('failed:');
  for (const f of failed) {
    console.log(`  ${f.name}: ${f.status}`);
  }
  process.exit(1);
}
