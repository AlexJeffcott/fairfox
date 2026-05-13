// `fairfox export <path>` — dump every $meshState document this device
// has hydrated into a single JSON file. Decrypted, plain-text,
// human-readable; the file is the data you would otherwise rely on
// another paired device to mirror back to you.
//
// Storage-only access (same pattern as `fairfox doctor`): reads the
// local Automerge repo under ~/.fairfox/mesh/ without joining
// signalling, so the export never kicks a running daemon off the
// relay.
//
// File mode 0600. The output carries Alex's keypair-derived identity
// id and every todo/agenda/etc payload in the clear — treat the file
// like a password manager export.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { awaitLoadedBudget } from '@fairfox/shared/loaded-budget';
import { meshFingerprint } from '@fairfox/shared/mesh-meta-state';
import { $meshState, configureMeshState, DEFAULT_MESH_KEY_ID, Repo } from '@fairfox/shared/polly';
import { keyringStorage, REPO_STORAGE_PATH } from '#src/mesh.ts';
import { loadUserIdentityFile } from '#src/user-identity-node.ts';

// Every $meshState key in the codebase as of writing. `template:app`
// is excluded — it's the scaffold copy-paste source, not a real
// sub-app. Keep this list in sync with the grep in
// `scripts/check-mesh-doc-coverage.ts`; the e2e coverage script is
// the canonical source of truth for "which keys exist".
const EXPORT_KEYS: readonly string[] = [
  'agenda:main',
  'chat:main',
  'docs:main',
  'family-phone:directory',
  'library:main',
  'mesh:devices',
  'mesh:meta',
  'mesh:users',
  'speakwell:sessions',
  'struggle:progress',
  'struggle:story',
  'todo:captures',
  'todo:projects',
  'todo:tasks',
];

// Each doc gets up to this long to hydrate from local storage. The
// failure mode this guards against is the same one budgeted in
// `acceptRecoveryBlob` — a $meshState wrapper whose underlying doc
// has never been written locally hangs on `handle.whenReady()`
// indefinitely. Storage-only Repos resolve every doc that *exists*
// on disk within a few hundred ms, so 5s is comfortably above the
// happy-path ceiling.
const HYDRATION_BUDGET_MS = 5000;

interface ExportBundle {
  readonly formatVersion: 1;
  readonly exportedAt: string;
  readonly meshFingerprint: string;
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly docs: Record<string, { hydrated: boolean; value: unknown }>;
}

function resolveOutPath(arg: string | undefined): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fallback = `fairfox-export-${stamp}.json`;
  if (!arg) {
    return resolve(process.cwd(), fallback);
  }
  const expanded = arg.startsWith('~') ? arg.replace(/^~/, process.env.HOME ?? '~') : arg;
  const abs = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
  // If the user pointed at a directory (path ends with /) treat it
  // as a destination directory and pick our own filename inside it.
  // Trailing slash is the explicit signal so we don't have to stat
  // a non-existent path and guess.
  if (expanded.endsWith('/')) {
    return resolve(abs, fallback);
  }
  return abs;
}

export async function exportCmd(args: readonly string[]): Promise<number> {
  const outPath = resolveOutPath(args[0]);
  const identity = await loadUserIdentityFile();

  const keyring = await keyringStorage().load();
  const docKey = keyring?.documentKeys.get(DEFAULT_MESH_KEY_ID);
  const fingerprint = docKey ? await meshFingerprint(docKey) : '(no-fingerprint)';

  const repo = new Repo({
    storage: new NodeFSStorageAdapter(REPO_STORAGE_PATH),
  });
  configureMeshState(repo);

  const docs: Record<string, { hydrated: boolean; value: unknown }> = {};
  for (const key of EXPORT_KEYS) {
    const wrapper = $meshState<Record<string, unknown>>(key, {});
    const hydrated = await awaitLoadedBudget(wrapper.loaded, HYDRATION_BUDGET_MS);
    docs[key] = { hydrated, value: hydrated ? wrapper.value : null };
  }

  const bundle: ExportBundle = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    meshFingerprint: fingerprint,
    userId: identity?.userId ?? null,
    displayName: identity?.displayName ?? null,
    docs,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(bundle, null, 2), { mode: 0o600 });

  const hydratedCount = Object.values(docs).filter((d) => d.hydrated).length;
  const totalBytes = JSON.stringify(bundle).length;
  process.stdout.write(
    `wrote ${outPath} (${hydratedCount}/${EXPORT_KEYS.length} docs hydrated, ${totalBytes} bytes)\n`
  );
  process.stdout.write(
    'Treat this file as confidential. It contains decrypted todo, library, and other mesh data in plain text.\n'
  );
  return 0;
}
