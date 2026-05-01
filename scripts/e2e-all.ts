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
  { name: 'user-revocation', file: 'e2e-user-revocation.ts', timeoutMs: 180_000 },
  { name: 'chat-context-task', file: 'e2e-chat-context-task.ts', timeoutMs: 240_000 },
  { name: 'chat-sweep', file: 'e2e-chat-sweep.ts', timeoutMs: 180_000 },
  { name: 'mesh-large-doc', file: 'e2e-mesh-large-doc.ts', timeoutMs: 300_000 },
  // Still deferred — `e2e-chat-leader-lease.ts` exposes a polly
  // mesh-rediscovery issue: when one of two long-lived relays dies,
  // a brief CLI peer that reconnects after the kill cannot
  // establish a WebRTC channel with the surviving relay (relayB
  // reports `peers=0` throughout). The lease state machine itself
  // is correct (relayB takes `lease=self` after TTL); the test
  // infrastructure can't deliver a follow-up message to the
  // survivor through signalling. Needs a polly fix before this can
  // pass deterministically.
  //
  // The lease state-machine properties this e2e was meant to verify
  // (mutual exclusion, eventual handoff after holder death) are now
  // covered by `specs/tla/LeaseHandoff.tla` — model-checked with
  // TLC via `bun run tla:check`, independent of WebRTC plumbing.
  //
  // Also deferred — `e2e-revoke-then-write.ts`. The fairfox-side
  // wire-up calls polly's `revokeDevice` for each peerId tied to
  // the target user in `mesh:devices.ownerUserIds`, but those
  // bindings get dropped on convergence because mesh:devices
  // updates use top-level map-replacement that races between
  // peers. Closing the loop needs per-key writes in
  // `upsertDeviceEntry`; out of scope for the mutation-coverage
  // closure. See the file header for the full diagnosis.
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
