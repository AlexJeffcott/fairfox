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
import { documentIndexState } from '@fairfox/shared/document-index-state';
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
  /** Sum of `binary.byteLength` across every row for this docId. */
  bytes: number;
  /** Number of rows in the store for this docId — snapshots + incrementals. */
  rows: number;
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

export async function collectDocSizes(): Promise<DocSizeRow[]> {
  const raw = await readRawSizes();
  const docIdToKey = new Map<string, string>();
  for (const { key, wrapper } of KNOWN_WRAPPERS) {
    const docId = wrapper.handle?.documentId;
    if (typeof docId === 'string') {
      docIdToKey.set(docId, key);
    }
  }
  const rows: DocSizeRow[] = [];
  for (const [docId, raw_] of raw) {
    rows.push({
      key: docIdToKey.get(docId) ?? '(unknown)',
      docId: `${docId.slice(0, 12)}…`,
      bytes: raw_.bytes,
      rows: raw_.rows,
    });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  return rows;
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

export async function refreshDocSizes(): Promise<void> {
  try {
    const rows = await collectDocSizes();
    docSizesText.value = formatDocSizesTable(rows);
  } catch (err) {
    docSizesText.value = `(error: ${err instanceof Error ? err.message : String(err)})`;
  }
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
