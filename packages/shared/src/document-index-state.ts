// Document index — the runtime mapping from a logical `$meshState`
// key to the currently-live `DocumentId` after one or more
// compactions. ADR 0008.
//
// When a key has never been compacted, the entry is absent and
// polly falls back to `deriveDocumentId(key)`. When an admin runs
// `fairfox mesh compact <key>`, the new doc is seeded at
// `deriveDocumentId(key + ':v' + isoTimestamp)` and the index
// entry for the logical key is updated to point at it. Subsequent
// `$meshState(key)` constructions on any device that has synced
// the index transparently land on the cleaned doc.
//
// The index doc itself uses the legacy derived id — the resolver
// must short-circuit on `mesh:document-index` to avoid recursing
// into itself when it tries to look up its own current id.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import type { DocHandle } from '@fairfox/shared/polly';

interface DocumentIndexPrimitive {
  readonly value: DocumentIndexDoc;
  readonly loaded: Promise<void>;
  readonly handle: DocHandle<DocumentIndexDoc> | undefined;
}

/** Single entry in {@link DocumentIndexDoc.index}, one per logical
 * key that has been compacted at least once. */
export interface DocumentIndexEntry {
  [key: string]: unknown;
  /** Stringified `DocumentId` of the currently-live document for
   * this logical key. `$meshState(key)` resolution returns this
   * via the polly resolver hook. */
  currentDocId: string;
  /** Past `DocumentId`s in chronological order, oldest first. Each
   * was current at some point; the most-recent compaction sealed
   * the previous entry and pushed it here. Useful for forensics
   * and for the grace-period dual-write window (ADR 0008
   * deferred); empty on a fresh compaction. */
  sealedDocIds: string[];
  /** ISO 8601 timestamp of the most recent compaction for this
   * key. */
  compactedAt: string;
  /** Hex-encoded `userId` of the admin who triggered the
   * compaction. The matching signature lives on the index row's
   * `signature` field (ADR 0008 — defers strict verification
   * until the sentinel + dual-write phase lands). */
  compactedBy: string;
  /** Signature over the row's canonical bytes by the
   * `compactedBy` user key. Empty during the lenient pre-v1.0
   * window; required once the compaction permission is enforced
   * at every read. */
  signature: number[];
}

export interface DocumentIndexDoc {
  [key: string]: unknown;
  /** Per logical `$meshState` key → current docId mapping. Keys
   * absent from this map resolve via polly's deterministic derive
   * (legacy / never-compacted). */
  index: Record<string, DocumentIndexEntry>;
}

const INITIAL: DocumentIndexDoc = { index: {} };

let _indexPrimitive: DocumentIndexPrimitive | null = null;

function primitive(): DocumentIndexPrimitive {
  if (_indexPrimitive === null) {
    _indexPrimitive = $meshState<DocumentIndexDoc>('mesh:document-index', INITIAL);
  }
  return _indexPrimitive;
}

export const documentIndexState: DocumentIndexPrimitive = {
  get value(): DocumentIndexDoc {
    return primitive().value;
  },
  get loaded(): Promise<void> {
    return primitive().loaded;
  },
  get handle(): DocHandle<DocumentIndexDoc> | undefined {
    return primitive().handle;
  },
};

/** The logical key of the index document itself. The polly docId
 * resolver short-circuits on this key (returns `undefined`) so the
 * index doesn't try to look up its own current id and recurse. */
export const DOCUMENT_INDEX_KEY = 'mesh:document-index';

/** Look up the current docId for a logical key. Returns `undefined`
 * when the key has never been compacted (legacy / derived
 * resolution) or when the index doc hasn't hydrated yet. The
 * polly resolver consults this on every wrapper construction;
 * caller must already have ensured the index is loaded if it
 * needs an up-to-date answer. */
export function currentDocIdForKey(key: string): string | undefined {
  if (key === DOCUMENT_INDEX_KEY) {
    return undefined;
  }
  const entry = documentIndexState.value.index[key];
  return entry?.currentDocId;
}
