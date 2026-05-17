// One-shot: enumerate every known $meshState key, derive its docId,
// and look up on-disk size at REPO_STORAGE_PATH/<prefix>/<docId>.

export {};

process.env.FAIRFOX_HOME = `${process.env.HOME}/.fairfox`;

const { existsSync, readdirSync, statSync } = await import('node:fs');
const { join } = await import('node:path');
const { deriveDocumentId } = await import('@fairfox/shared/polly');
const { documentIndexState } = await import('@fairfox/shared/document-index-state');
const { awaitLoadedBudget } = await import('@fairfox/shared/loaded-budget');
const { openMeshClientReadOnly, REPO_STORAGE_PATH } = await import('#src/mesh.ts');

const KEYS = [
  'mesh:users',
  'mesh:devices',
  'mesh:document-index',
  'mesh:meta',
  'mesh:applications',
  'agenda:main',
  'chat:main',
  'chat:health',
  'daemon:leader',
  'todo:projects',
  'todo:tasks',
  'todo:captures',
  'library:refs',
  'library:docs',
  'library:world-bible',
  'speakwell:sessions',
  'speakwell:prompts',
  'struggle:state',
  'struggle:choices',
  'struggle:save',
  'family:humans',
  'family:devices',
  'docs:main',
  'assistant:main',
  'assistant:state',
];

function walkSize(p: string): number {
  if (!existsSync(p)) {
    return 0;
  }
  const st = statSync(p);
  if (!st.isDirectory()) {
    return st.size;
  }
  let s = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    s += walkSize(join(p, e.name));
  }
  return s;
}

const mesh = openMeshClientReadOnly();
try {
  await awaitLoadedBudget(documentIndexState.loaded, 5000);
  const rawIndex: unknown = documentIndexState.value.index ?? {};
  const index = rawIndex as unknown as Record<string, { currentDocId?: string }>;

  type Row = { key: string; docId: string; size: number; viaIndex: boolean };
  const rows: Row[] = [];
  for (const key of KEYS) {
    const indexed = index[key]?.currentDocId;
    const docId = indexed ?? String(deriveDocumentId(key));
    const size = walkSize(join(REPO_STORAGE_PATH, docId.slice(0, 2), docId.slice(2)));
    rows.push({ key, docId, size, viaIndex: !!indexed });
  }
  rows.sort((a, b) => b.size - a.size);
  process.stdout.write(`REPO_STORAGE_PATH: ${REPO_STORAGE_PATH}\n\n`);
  process.stdout.write('     size   docId                          via  key\n');
  for (const r of rows) {
    const mb = (r.size / (1024 * 1024)).toFixed(2);
    process.stdout.write(
      `${mb.padStart(8)} MB  ${r.docId.padEnd(28)}  ${(r.viaIndex ? 'idx' : 'der').padEnd(3)}  ${r.key}\n`
    );
  }

  process.stdout.write('\n--- on-disk docs not matched to a known key ---\n');
  const matched = new Set(rows.map((r) => r.docId));
  if (existsSync(REPO_STORAGE_PATH)) {
    for (const prefix of readdirSync(REPO_STORAGE_PATH)) {
      const prefixDir = join(REPO_STORAGE_PATH, prefix);
      if (!statSync(prefixDir).isDirectory()) {
        continue;
      }
      for (const remainder of readdirSync(prefixDir)) {
        const fullDocId = prefix + remainder;
        if (matched.has(fullDocId)) {
          continue;
        }
        const size = walkSize(join(prefixDir, remainder));
        const mb = (size / (1024 * 1024)).toFixed(2);
        process.stdout.write(`${mb.padStart(8)} MB  ${fullDocId}\n`);
      }
    }
  }
} finally {
  await mesh.close();
}
