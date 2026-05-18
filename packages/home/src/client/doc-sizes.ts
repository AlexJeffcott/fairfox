// On-disk size of every $meshState document in this device's polly
// store, with the logical key labelled. Reads the `fairfox-mesh`
// IDB directly (the polly storage adapter writes
// `{ key: string[], binary: Uint8Array }` rows; the first key part
// is the documentId), buckets bytes per documentId, and joins
// against the running wrappers so the operator sees the logical
// name beside each row.
//
// Used by the Help tab to surface a bloated doc — the typical
// suspect being a `mesh:devices` that accumulated thousands of ops
// from a previous lastSeenAt-loop bug. The number to watch is the
// per-key sum: a healthy heartbeat doc is on the order of a few KB;
// a bloated one runs into MB and explains the second-scale automerge
// replay observed on first peer sync.

import { agenda } from '@fairfox/agenda/state';
import { chatHealth, chatState, sessionsActive } from '@fairfox/chat/state';
import { docsState } from '@fairfox/docs/state';
import { directoryState } from '@fairfox/family-phone-admin/state';
import { libraryState } from '@fairfox/library/state';
import { devicesState } from '@fairfox/shared/devices-state';
import { type DocumentIndexEntry, documentIndexState } from '@fairfox/shared/document-index-state';
import { meshMetaState } from '@fairfox/shared/mesh-meta-state';
import { usersState } from '@fairfox/shared/users-state';
import { sessionsState as speakwellSessions } from '@fairfox/speakwell/state';
import { progressState, storyState } from '@fairfox/the-struggle/state';
import { capturesState, projectsState, tasksState } from '@fairfox/todo-v2/state';
import { signal } from '@preact/signals';

interface WrapperLike {
  readonly handle: { documentId: string } | undefined;
}

interface NamedWrapper {
  key: string;
  wrapper: WrapperLike;
}

// The fairfox-specific primitive types narrow polly's CrdtPrimitive
// shape to `{ value, loaded, handle }` and drop the `.key` field, so
// the logical-key↔wrapper mapping is reconstructed by hand here. The
// list is the closed set of `$meshState` calls in the repo; new docs
// should grow this table the same way `mesh-doc-coverage` tracks
// them for the e2e check.
const KNOWN_WRAPPERS: NamedWrapper[] = [
  { key: 'mesh:devices', wrapper: devicesState },
  { key: 'mesh:users', wrapper: usersState },
  { key: 'mesh:meta', wrapper: meshMetaState },
  { key: 'mesh:document-index', wrapper: documentIndexState },
  { key: 'chat:main', wrapper: chatState },
  { key: 'chat:health', wrapper: chatHealth },
  { key: 'sessions:active', wrapper: sessionsActive },
  { key: 'docs:main', wrapper: docsState },
  { key: 'family:directory', wrapper: directoryState },
  { key: 'library:main', wrapper: libraryState },
  { key: 'speakwell:sessions', wrapper: speakwellSessions },
  { key: 'struggle:story', wrapper: storyState },
  { key: 'struggle:progress', wrapper: progressState },
  { key: 'agenda:main', wrapper: agenda },
  { key: 'todo:projects', wrapper: projectsState },
  { key: 'todo:tasks', wrapper: tasksState },
  { key: 'todo:captures', wrapper: capturesState },
];

export interface DocSizeRow {
  /** Logical $meshState key, or "(unknown)" for orphaned docIds. */
  key: string;
  /** Stringified Automerge DocumentId, abbreviated for display. */
  docId: string;
  /** Full Automerge DocumentId — used by the cleanup path to scope
   * a removeRange to a single sealed doc. */
  fullDocId: string;
  /** Sum of `binary.byteLength` across every row for this docId. */
  bytes: number;
  /** Number of rows in the store for this docId — snapshots + incrementals. */
  rows: number;
  /** True when this docId appears in `mesh:document-index`'s
   * sealedDocIds for some key — i.e. it was compacted, the current
   * wrapper now binds to a fresh docId, and the bytes here are
   * pure historical residue safe to delete once peers have caught up. */
  sealed: boolean;
}

const DB_NAME = 'fairfox-mesh';
const STORE_NAME = 'documents';

function openMeshStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface RawRow {
  bytes: number;
  rows: number;
}

async function readRawSizes(): Promise<Map<string, RawRow>> {
  const db = await openMeshStore();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const sizes = new Map<string, RawRow>();
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const rawKey = cursor.key;
        const docId = Array.isArray(rawKey) ? String(rawKey[0]) : String(rawKey);
        const value = cursor.value as unknown as { binary?: unknown } | undefined;
        const binary = value?.binary;
        const bytes = binary instanceof Uint8Array ? binary.byteLength : 0;
        const current = sizes.get(docId) ?? { bytes: 0, rows: 0 };
        current.bytes += bytes;
        current.rows += 1;
        sizes.set(docId, current);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return sizes;
  } finally {
    db.close();
  }
}

/** Build a lookup of sealed docId → logical key from the running
 * `mesh:document-index`. Used to label compacted-doc residue in the
 * size table and to drive the cleanup action. Returns an empty Map
 * when the index hasn't hydrated or has no entries; both states are
 * indistinguishable from the on-disk byte view, and a sealed row
 * whose key we can't determine falls back to "(unknown sealed)". */
function readSealedDocIndex(): Map<string, string> {
  const sealedToKey = new Map<string, string>();
  const index: Record<string, DocumentIndexEntry> = documentIndexState.value.index;
  for (const [key, entry] of Object.entries(index)) {
    for (const sealedDocId of entry.sealedDocIds) {
      sealedToKey.set(sealedDocId, key);
    }
  }
  return sealedToKey;
}

export async function collectDocSizes(): Promise<DocSizeRow[]> {
  const raw = await readRawSizes();
  const docIdToKey = new Map<string, string>();
  for (const { key, wrapper } of KNOWN_WRAPPERS) {
    const docId = wrapper.handle?.documentId;
    if (typeof docId === 'string') {
      docIdToKey.set(docId, key);
    }
  }
  const sealedToKey = readSealedDocIndex();
  const rows: DocSizeRow[] = [];
  for (const [docId, raw_] of raw) {
    const sealed = sealedToKey.has(docId);
    const liveKey = docIdToKey.get(docId);
    const sealedFor = sealedToKey.get(docId);
    const label = liveKey ?? (sealedFor ? `(sealed: ${sealedFor})` : '(unknown)');
    rows.push({
      key: label,
      docId: `${docId.slice(0, 12)}…`,
      fullDocId: docId,
      bytes: raw_.bytes,
      rows: raw_.rows,
      sealed,
    });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  return rows;
}

/** Drop every snapshot + incremental row whose key starts with the
 * supplied docId from the `fairfox-mesh` IDB. Polly's storage adapter
 * stores rows under `[docId, ...]` keys, so the range
 * `[docId] … [docId, '￿']` is exactly this doc's bytes and
 * nothing else. Does NOT tear down polly's mesh adapter — the running
 * app keeps using its open connection on other docs while this write
 * transaction is queued. Returns the number of rows the delete
 * touched (best-effort: the IDB delete-by-range op doesn't surface
 * a count, so we re-read the doc after to confirm zero bytes). */
async function deleteDocRange(docId: string): Promise<void> {
  const db = await openMeshStore();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound([docId], [docId, '￿']);
    store.delete(range);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export interface CleanupSummary {
  /** Sealed docIds that were deleted, with the logical key they came from. */
  deleted: Array<{ key: string; docId: string; bytes: number }>;
  /** Sum of bytes freed across every deleted sealed doc. */
  bytesFreed: number;
}

/** Delete every sealed doc the index knows about that is still
 * present on disk in `fairfox-mesh`. The redirect sentinel that
 * lives on the sealed doc itself is what helps peers who haven't
 * synced the index yet bind to the cleaned doc — once the index
 * has synced to a device, that device's sealed-doc bytes are pure
 * residue and can be removed locally. Run after you've confirmed
 * (via the Sync diagnostics) that every paired peer has the new
 * `mesh:document-index` entry. */
export async function deleteAllSealedDocs(): Promise<CleanupSummary> {
  const rows = await collectDocSizes();
  const sealedRows = rows.filter((r) => r.sealed);
  let bytesFreed = 0;
  const deleted: CleanupSummary['deleted'] = [];
  for (const row of sealedRows) {
    await deleteDocRange(row.fullDocId);
    bytesFreed += row.bytes;
    deleted.push({ key: row.key, docId: row.docId, bytes: row.bytes });
  }
  return { deleted, bytesFreed };
}

export function formatDocSizesTable(rows: DocSizeRow[]): string {
  if (rows.length === 0) {
    return '(no documents in fairfox-mesh IDB)';
  }
  const header = ['key', 'docId', 'rows', 'size'];
  const body = rows.map((r) => [r.key, r.docId, String(r.rows), formatBytes(r.bytes)]);
  const all = [header, ...body];
  const widths = header.map((_, col) =>
    all.reduce((max, line) => Math.max(max, line[col]?.length ?? 0), 0)
  );
  return all
    .map((line) =>
      line
        .map((cell, col) => {
          const w = widths[col] ?? 0;
          // Right-align rows and size for legibility.
          return col >= 2 ? cell.padStart(w) : cell.padEnd(w);
        })
        .join('  ')
    )
    .join('\n');
}

export const docSizesText = signal<string>('(loading…)');
export const docSizesHasSealed = signal<boolean>(false);

export async function refreshDocSizes(): Promise<void> {
  try {
    const rows = await collectDocSizes();
    docSizesText.value = formatDocSizesTable(rows);
    docSizesHasSealed.value = rows.some((r) => r.sealed);
  } catch (err) {
    docSizesText.value = `(error: ${err instanceof Error ? err.message : String(err)})`;
    docSizesHasSealed.value = false;
  }
}

export async function cleanupSealedAndRefresh(): Promise<CleanupSummary> {
  const summary = await deleteAllSealedDocs();
  await refreshDocSizes();
  return summary;
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n}B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)}KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}
