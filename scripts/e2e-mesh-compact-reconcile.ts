/**
 * End-to-end test for ADR 0008 document compaction + reconcile.
 *
 *   1. Bootstrap a fresh admin via `fairfox mesh init`. mesh:devices
 *      has exactly one row.
 *   2. Run `fairfox mesh compact mesh:devices`. Asserts:
 *        - command exits 0
 *        - `mesh:document-index` has an entry for mesh:devices with a
 *          new `currentDocId` and one entry in `sealedDocIds`
 *        - the sealed doc carries a `__compaction__` sentinel
 *          pointing at the new doc
 *        - the new doc holds the original (live) device row
 *   3. Simulate the grace-period bug: open a local Repo, find the
 *      sealed docId, write a NEW fake device entry directly into the
 *      sealed doc. This is what an offline peer's stale-index
 *      client would do.
 *   4. Run `fairfox mesh reconcile mesh:devices`. Asserts:
 *        - command exits 0
 *        - stdout says `copied: 1`
 *        - the new doc now contains the fake device entry
 *   5. Idempotency: run reconcile a second time. Asserts:
 *        - stdout says `copied: 0` (no double-merge)
 *
 * The test exercises the user-facing CLI surface. Bypasses
 * signalling — the WebSocket connect fails fast against an
 * unreachable host and the commands fall through to local-only
 * mode (waitForPeer timeout returns false, write proceeds against
 * local storage). About 20s end-to-end.
 *
 *   bun scripts/e2e-mesh-compact-reconcile.ts
 */
// @covers: mesh:devices, mesh:document-index, mesh:users, mesh:meta

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Repo } from '@automerge/automerge-repo';
import {
  type DocumentId,
  interpretAsDocumentId,
  isValidDocumentId,
} from '@automerge/automerge-repo/slim';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { deriveDocumentId } from '@fairfox/polly/mesh';

const HOME = '/tmp/fairfox-e2e-compact-reconcile';
const BUILT_BUNDLE = resolve(import.meta.dir, '..', 'packages', 'cli', 'dist', 'fairfox.js');
const FAKE_PEER_ID = 'deadbeefcafefade';
const FAKE_DEVICE_NAME = 'offline-peer-post-seal';

function trace(label: string, msg: string): void {
  console.log(`[${label}] ${msg}`);
}

function pass(msg: string): void {
  console.log(`[PASS] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
}

function buildBundleIfMissing(): void {
  if (existsSync(BUILT_BUNDLE)) {
    trace('build', 'reusing existing CLI bundle');
    return;
  }
  trace('build', 'building packages/cli/dist/fairfox.js');
  const r = spawnSync('bun', ['run', 'build.ts'], {
    cwd: resolve(import.meta.dir, '..', 'packages', 'cli'),
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    fail(`cli build failed (exit ${r.status ?? '?'})`);
  }
  if (!existsSync(BUILT_BUNDLE)) {
    fail(`cli build did not produce ${BUILT_BUNDLE}`);
  }
}

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runCli(args: readonly string[]): CliResult {
  // FAIRFOX_URL defaults to the prod signalling origin; tests that
  // need a different relay set it before invoking this script. The
  // commands tolerate a peerless network (waitForPeer times out and
  // the write proceeds against local storage), so prod-or-localhost
  // doesn't change the test's correctness — just which signalling
  // server sees an ephemeral test peer.
  const r = spawnSync('bun', [BUILT_BUNDLE, ...args], {
    env: { ...process.env, FAIRFOX_HOME: HOME },
    encoding: 'utf-8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? 1,
  };
}

interface DeviceEntry {
  peerId?: string;
  name?: string;
  revokedAt?: string;
  [k: string]: unknown;
}

interface DevicesDoc {
  devices?: Record<string, DeviceEntry>;
  __compaction__?: {
    migratedTo: string;
    sealedAt: string;
    sealedBy: string;
    signature: unknown;
  };
  [k: string]: unknown;
}

interface IndexEntry {
  currentDocId: string;
  sealedDocIds: string[];
  compactedAt: string;
  compactedBy: string;
  signature: unknown;
}

interface IndexDoc {
  index?: Record<string, IndexEntry>;
}

function openLocalRepo(): Repo {
  return new Repo({
    storage: new NodeFSStorageAdapter(resolve(HOME, 'mesh')),
    isEphemeral: true,
  });
}

async function readDoc<T>(repo: Repo, docId: DocumentId): Promise<T | undefined> {
  const handle = await repo.find<T>(docId, {
    allowableStates: ['ready', 'unavailable'],
  });
  return handle.doc();
}

async function readDocHandle<T>(
  repo: Repo,
  docId: DocumentId
): Promise<{ doc: T | undefined; handle: Awaited<ReturnType<typeof repo.find<T>>> }> {
  const handle = await repo.find<T>(docId, {
    allowableStates: ['ready', 'unavailable'],
  });
  return { doc: handle.doc(), handle };
}

// ---- 0. clean slate
rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });
buildBundleIfMissing();

// ---- 1. bootstrap admin
trace('init', 'fairfox init e2e-compact --admin Admin');
const init = runCli(['init', 'e2e-compact', '--admin', 'Admin']);
if (init.status !== 0) {
  fail(`mesh init exit ${init.status}\nstdout:\n${init.stdout}\nstderr:\n${init.stderr}`);
}
pass('admin bootstrapped');

// ---- 2. compact
trace('compact', 'fairfox mesh compact mesh:devices');
const compact = runCli(['mesh', 'compact', 'mesh:devices']);
if (compact.status !== 0) {
  fail(
    `mesh compact exit ${compact.status}\nstdout:\n${compact.stdout}\nstderr:\n${compact.stderr}`
  );
}
pass(
  `compact ran:\n${compact.stdout
    .trim()
    .split('\n')
    .slice(0, 6)
    .map((l) => `    ${l}`)
    .join('\n')}`
);

// ---- 3. inspect
const repo1 = openLocalRepo();
const indexDocId = deriveDocumentId('mesh:document-index');
const indexDoc = await readDoc<IndexDoc>(repo1, indexDocId);
const entry = indexDoc?.index?.['mesh:devices'];
if (!entry) {
  fail(`document-index has no entry for mesh:devices. doc=${JSON.stringify(indexDoc)}`);
}
if (!entry.currentDocId || !entry.sealedDocIds || entry.sealedDocIds.length === 0) {
  fail(`malformed index entry: ${JSON.stringify(entry)}`);
}
const currentDocIdStr = entry.currentDocId;
const sealedDocIdStr = entry.sealedDocIds[entry.sealedDocIds.length - 1] ?? '';
if (!isValidDocumentId(currentDocIdStr) || !isValidDocumentId(sealedDocIdStr)) {
  fail(`docIds in index are not valid: current=${currentDocIdStr} sealed=${sealedDocIdStr}`);
}
pass(
  `document-index entry: current=${currentDocIdStr.slice(0, 16)}… sealed=${sealedDocIdStr.slice(0, 16)}…`
);

const sealedDocId = interpretAsDocumentId(sealedDocIdStr);
const sealedReadback = await readDocHandle<DevicesDoc>(repo1, sealedDocId);
const sealedDoc = sealedReadback.doc;
if (!sealedDoc?.__compaction__) {
  fail(`sealed doc has no __compaction__ sentinel. doc=${JSON.stringify(sealedDoc)}`);
}
if (sealedDoc.__compaction__.migratedTo !== currentDocIdStr) {
  fail(
    `sentinel.migratedTo (${sealedDoc.__compaction__.migratedTo}) doesn't match index.currentDocId (${currentDocIdStr})`
  );
}
pass(`sealed sentinel present: migratedTo=${sealedDoc.__compaction__.migratedTo.slice(0, 16)}…`);

const currentDocId = interpretAsDocumentId(currentDocIdStr);
const currentDocBefore = await readDoc<DevicesDoc>(repo1, currentDocId);
const liveCountBefore = Object.keys(currentDocBefore?.devices ?? {}).length;
if (liveCountBefore !== 1) {
  fail(
    `expected 1 live device in new doc after compaction; got ${liveCountBefore}. doc=${JSON.stringify(currentDocBefore)}`
  );
}
pass(`new doc holds ${liveCountBefore} live device(s)`);

// ---- 4. write post-seal entry into sealed doc
trace('post-seal-write', `injecting ${FAKE_PEER_ID} into sealed doc via repo.change`);
sealedReadback.handle.change((d) => {
  if (!d.devices) {
    d.devices = {};
  }
  d.devices[FAKE_PEER_ID] = {
    peerId: FAKE_PEER_ID,
    name: FAKE_DEVICE_NAME,
    publicKey: [],
    ownerUserIds: [],
    endorsements: [],
    lastSeenAt: new Date().toISOString(),
  };
});
await repo1.flush([sealedDocId]);
await repo1.shutdown();
pass('post-seal entry written to sealed doc');

// ---- 5. reconcile
trace('reconcile', 'fairfox mesh reconcile mesh:devices');
const reconcile = runCli(['mesh', 'reconcile', 'mesh:devices']);
if (reconcile.status !== 0) {
  fail(
    `mesh reconcile exit ${reconcile.status}\nstdout:\n${reconcile.stdout}\nstderr:\n${reconcile.stderr}`
  );
}
if (!reconcile.stdout.includes('copied: 1 ')) {
  fail(`reconcile didn't report copied: 1. stdout:\n${reconcile.stdout}`);
}
pass('reconcile reported copied: 1');

// ---- 6. verify post-seal entry made it into the new doc
const repo2 = openLocalRepo();
const currentDocAfter = await readDoc<DevicesDoc>(repo2, currentDocId);
const reconciledEntry = currentDocAfter?.devices?.[FAKE_PEER_ID];
if (!reconciledEntry) {
  fail(
    `post-seal entry "${FAKE_PEER_ID}" missing from new doc after reconcile. devices=${JSON.stringify(currentDocAfter?.devices)}`
  );
}
if (reconciledEntry.name !== FAKE_DEVICE_NAME) {
  fail(`reconciled entry has wrong name: ${reconciledEntry.name} (expected ${FAKE_DEVICE_NAME})`);
}
pass(`post-seal entry in new doc: ${reconciledEntry.name}`);
await repo2.shutdown();

// ---- 7. idempotency
trace('reconcile-2', 'fairfox mesh reconcile mesh:devices (should be no-op)');
const reconcile2 = runCli(['mesh', 'reconcile', 'mesh:devices']);
if (reconcile2.status !== 0) {
  fail(
    `second reconcile exit ${reconcile2.status}\nstdout:\n${reconcile2.stdout}\nstderr:\n${reconcile2.stderr}`
  );
}
if (!reconcile2.stdout.includes('copied: 0 ')) {
  fail(`second reconcile copied non-zero entries. stdout:\n${reconcile2.stdout}`);
}
pass('second reconcile idempotent (copied: 0)');

console.log('\nALL CHECKS PASSED');
