// Diagnostic: open a fresh read-only Repo against an arbitrary
// FAIRFOX_HOME and dump the contents of the shared `$meshState`
// wrappers. Built to investigate the user-revocation sync failure
// (#26) by comparing what admin and phone each have on disk after
// the test fails.
//
// Usage:
//   bun packages/cli/src/probe-mesh-storage.ts [path-to-fairfox-home]
//
// Default home: /tmp/fairfox-e2e-revoke-phone. Reads:
//   - mesh:document-index (compaction map; empty `{}` means every
//     wrapper resolves via `deriveDocumentId(key)`)
//   - mesh:users (user registry + revocation state)
//   - mesh:devices (paired devices)
//
// Not part of the CLI bundle — `src/bin.ts` doesn't import it, so
// the production build tree-shakes it out. Kept under `src/` so it
// has access to `#src/mesh.ts`'s `openMeshClientReadOnly` and the
// docId resolver registration that runs at module init.

export {};

const HOME = process.argv[2] ?? '/tmp/fairfox-e2e-revoke-phone';
process.env.FAIRFOX_HOME = HOME;
process.stdout.write(`probing FAIRFOX_HOME=${HOME}\n`);

// Set the env BEFORE importing anything that reads
// `fairfoxPath('mesh')` at module-init time, or REPO_STORAGE_PATH
// locks onto the user's real ~/.fairfox/ instead of the override.
const { awaitLoadedBudget } = await import('@fairfox/shared/loaded-budget');
const { documentIndexState } = await import('@fairfox/shared/document-index-state');
const { usersState } = await import('@fairfox/shared/users-state');
const { devicesState } = await import('@fairfox/shared/devices-state');
const { openMeshClientReadOnly, REPO_STORAGE_PATH } = await import('#src/mesh.ts');

process.stdout.write(`REPO_STORAGE_PATH: ${REPO_STORAGE_PATH}\n\n`);

const mesh = openMeshClientReadOnly();
try {
  process.stdout.write('--- mesh:document-index ---\n');
  const indexLoaded = await awaitLoadedBudget(documentIndexState.loaded, 30_000);
  process.stdout.write(`loaded: ${indexLoaded}\n`);
  process.stdout.write(`handle.documentId: ${documentIndexState.handle?.documentId}\n`);
  process.stdout.write(`index: ${JSON.stringify(documentIndexState.value.index, null, 2)}\n\n`);

  process.stdout.write('--- mesh:users ---\n');
  const usersLoaded = await awaitLoadedBudget(usersState.loaded, 30_000);
  process.stdout.write(`loaded: ${usersLoaded}\n`);
  process.stdout.write(`handle.documentId: ${usersState.handle?.documentId}\n`);
  const userKeys = Object.keys(usersState.value.users);
  process.stdout.write(`users count: ${userKeys.length}\n`);
  for (const [id, entry] of Object.entries(usersState.value.users)) {
    process.stdout.write(
      `  ${id.slice(0, 16)}…: name=${entry.displayName} roles=${entry.roles.join(',')} revokedAt=${entry.revokedAt ?? '-'}\n`
    );
  }

  process.stdout.write('\n--- mesh:devices ---\n');
  const devicesLoaded = await awaitLoadedBudget(devicesState.loaded, 30_000);
  process.stdout.write(`loaded: ${devicesLoaded}\n`);
  process.stdout.write(`handle.documentId: ${devicesState.handle?.documentId}\n`);
  const deviceKeys = Object.keys(devicesState.value.devices);
  process.stdout.write(`devices count: ${deviceKeys.length}\n`);
  for (const peerId of deviceKeys) {
    process.stdout.write(`  ${peerId}\n`);
  }
} finally {
  await mesh.close();
}
