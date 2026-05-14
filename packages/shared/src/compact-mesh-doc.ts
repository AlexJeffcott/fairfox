// Document compaction primitive — ADR 0008.
//
// Reads the current materialised state of a logical `$meshState`
// key, applies a caller-supplied filter to drop dead entries
// (revoked rows, tombstones, expired invites), seeds a new
// Automerge document at a deterministic versioned id, and writes
// the index entry that points future `$meshState(key)` resolutions
// at the cleaned doc. The caller is responsible for reloading the
// surrounding process so wrappers re-resolve to the new doc — in
// the current single-process model the existing wrapper instance
// holds a handle to the previous doc.
//
// Limitations of this v1 primitive (carried as deferred work in
// ADR 0008's open questions):
//
// - No sealed-pointer sentinel in the old doc. Devices that load
//   the old doc don't know to follow the index; they read the
//   stale state until they sync the index. In fairfox's deploy
//   model — every device sees the index via normal mesh sync —
//   this window is short. A genuinely-offline device that comes
//   back online after compaction will sync the index along with
//   everything else.
// - No grace-period dual-write. Writes that land at the old doc
//   after the compaction stamp are not replayed into the new
//   doc. An offline device whose last write went to the old doc
//   loses that write. Document the limitation; admins should
//   only compact when no critical offline-pending writes are
//   outstanding.
// - No automatic GC. The old doc's bytes remain in every
//   device's storage forever until a manual delete (or a future
//   GC sweep) runs.

import * as Automerge from '@automerge/automerge';
import { documentIndexState } from '#src/document-index-state.ts';
// Polly's $meshState resolution lives in @fairfox/polly/mesh; this
// helper depends on the consumer having an open Repo whose
// configureMeshState call wired up the wrappers. Import lazily so
// the polly module is loaded on first call rather than at module
// init (matches how mesh-meta-state hydrates the keyring).
import { mesh } from '#src/ensure-mesh.ts';
import { deriveDocumentId } from '#src/polly-reexport.ts';
import { buildSealedSentinel, SEALED_SENTINEL_FIELD } from '#src/sealed-sentinel.ts';
import { userIdentity } from '#src/user-identity-state.ts';

/** Result of a successful compaction. The caller typically logs
 * these and triggers a process reload so subsequent
 * `$meshState(key)` constructions resolve to the new doc. */
export interface CompactionResult {
  /** The logical key that was compacted (e.g. `'mesh:devices'`). */
  key: string;
  /** The DocumentId-as-string of the previous live doc, now
   * archived in `mesh:document-index.index[key].sealedDocIds`. */
  previousDocId: string;
  /** The DocumentId-as-string of the freshly-seeded cleaned doc. */
  newDocId: string;
  /** Count of entries dropped by the filter. The cleaned doc
   * contains `before - removed` entries. */
  removed: number;
  /** ISO 8601 timestamp stamped into the index row. */
  compactedAt: string;
}

type MeshDoc = Record<string, unknown>;

interface CompactOptions<TDoc extends MeshDoc, TEntry> {
  /** The logical `$meshState` key being compacted. */
  key: string;
  /** The current $meshState wrapper for the key. The compaction
   * reads `wrapper.value` to source the materialised state and
   * (optionally) consults `wrapper.loaded` before reading. */
  wrapper: { value: TDoc; readonly loaded: Promise<void> };
  /** Extract the entry map from the document. For `mesh:devices`
   * this is `(doc) => doc.devices`; for arbitrary docs the
   * extractor maps the doc's shape to the inner map. */
  selectEntries: (doc: TDoc) => Record<string, TEntry>;
  /** Predicate: returns `true` for entries that should survive
   * compaction. Common shape for `mesh:devices`:
   * `(entry) => !entry.revokedAt`. */
  keep: (entry: TEntry) => boolean;
  /** Reconstruct the doc shape from the filtered entry map. For
   * `mesh:devices`: `(entries) => ({ devices: entries })`. */
  buildDoc: (entries: Record<string, TEntry>) => TDoc;
}

/** Run a compaction. Throws on the obvious failure modes (no
 * configured mesh, no local user identity, etc.). Returns a
 * {@link CompactionResult} on success. */
export async function compactMeshDoc<TDoc extends MeshDoc, TEntry>(
  options: CompactOptions<TDoc, TEntry>
): Promise<CompactionResult> {
  const identity = userIdentity.value;
  if (!identity) {
    throw new Error(
      'compactMeshDoc: no local user identity — bootstrap or import one before compacting.'
    );
  }
  if (!mesh) {
    throw new Error('compactMeshDoc: no configured mesh — open a mesh client first.');
  }

  // Source the current materialised state.
  await options.wrapper.loaded;
  const before = options.selectEntries(options.wrapper.value);
  const kept: Record<string, TEntry> = {};
  let removed = 0;
  for (const [entryKey, entry] of Object.entries(before)) {
    if (options.keep(entry)) {
      kept[entryKey] = entry;
    } else {
      removed += 1;
    }
  }
  const cleaned = options.buildDoc(kept);

  // Compute the new docId from the logical key + timestamp. Same
  // derivation polly uses internally — the index stores this id
  // so future `$meshState(key)` resolutions land here.
  const compactedAt = new Date().toISOString();
  const versionedKey = `${options.key}:v${compactedAt}`;
  const newDocumentId = deriveDocumentId(versionedKey);

  // Seed the cleaned state into the repo at the deterministic
  // docId. Mirrors polly's own `seeded-and-imported` path inside
  // `buildHandleFactory` — `Automerge.from + save` produces the
  // wire-format bytes, `repo.import(bytes, { docId })` registers
  // the handle in the cache, `doneLoading()` flips its state to
  // ready.
  const seeded = Automerge.save(Automerge.from(cleaned));
  const handle = mesh.repo.import(seeded, { docId: newDocumentId });
  handle.doneLoading();

  // ADR 0008 v2: write the sealed sentinel into the OLD doc so a
  // peer that reads the old doc directly (its index hasn't synced
  // the redirect yet, or its wrapper bound to the old docId
  // before the compaction landed) sees the pointer to the new
  // doc. The wrapper still resolves to the OLD doc inside this
  // same process — the resolver fires at lazy construction and
  // wrappers are cached — so writing through `options.wrapper`
  // here writes to the old doc by design.
  const newDocIdString = String(newDocumentId);
  const sentinel = buildSealedSentinel({
    migratedTo: newDocIdString,
    sealedAt: compactedAt,
    sealedBy: identity.userId,
  });
  options.wrapper.value = {
    ...options.wrapper.value,
    [SEALED_SENTINEL_FIELD]: sentinel,
  };

  // Record the compaction in the index. The previous current id
  // (if any) is rolled into `sealedDocIds`; if this is the first
  // compaction for the key, `sealedDocIds` starts empty.
  const previousEntry = documentIndexState.value.index[options.key];
  const previousDocId = previousEntry?.currentDocId ?? '';
  const nextSealed: string[] = previousEntry?.sealedDocIds ? [...previousEntry.sealedDocIds] : [];
  if (previousDocId) {
    nextSealed.push(previousDocId);
  }

  documentIndexState.value = {
    ...documentIndexState.value,
    index: {
      ...documentIndexState.value.index,
      [options.key]: {
        currentDocId: newDocIdString,
        sealedDocIds: nextSealed,
        compactedAt,
        compactedBy: identity.userId,
        // Lenient mode: signature is empty in v2. The strict
        // verification path waits on signing both the sentinel
        // and the index row together — both surfaces have to be
        // signed before either is verified, otherwise a malicious
        // peer can write a fake sentinel + unsigned index entry
        // and the redirect goes through.
        signature: [],
      },
    },
  };

  return {
    key: options.key,
    previousDocId,
    newDocId: newDocIdString,
    removed,
    compactedAt,
  };
}
