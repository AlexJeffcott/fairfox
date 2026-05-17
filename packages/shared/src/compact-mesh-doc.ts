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
import { type DocHandle, deriveDocumentId, type Repo } from '#src/polly-reexport.ts';
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
  /** The Automerge Repo to write the new doc into. Browser callers
   * pass `mesh.repo` from `ensure-mesh`; CLI callers pass
   * `client.repo` from `openMeshClient`. Same repo the wrapper's
   * `$meshState` resolved against. */
  repo: Repo;
  /** The current $meshState wrapper for the key. The compaction
   * reads `wrapper.value` to source the materialised state,
   * consults `wrapper.loaded` before reading, and writes the
   * sealed sentinel via `wrapper.handle.change` (per ADR 0009 —
   * per-key writes only; no top-level value-setter assigns). */
  wrapper: {
    value: TDoc;
    readonly loaded: Promise<void>;
    readonly handle: DocHandle<TDoc> | undefined;
  };
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
  const handle = options.repo.import(seeded, { docId: newDocumentId });
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
  // Per ADR 0009 non-negotiable #1 — write the sentinel through
  // the Automerge handle so the change lands as a per-key op,
  // not a top-level field replacement that would race concurrent
  // edits to other top-level fields and silently win/lose by
  // actor-id hash.
  const oldDocHandle = options.wrapper.handle;
  if (!oldDocHandle) {
    throw new Error(
      'compactMeshDoc: wrapper.handle not bridged — caller must await wrapper.loaded before compacting'
    );
  }
  oldDocHandle.change((doc: TDoc) => {
    (doc as Record<string, unknown>)[SEALED_SENTINEL_FIELD] = sentinel;
  });

  // Record the compaction in the index. The "previous" docId is
  // either the prior index entry's `currentDocId` (a re-compaction)
  // or polly's derived id for this logical key (the very first
  // compaction — the original doc lives at `deriveDocumentId(key)`).
  // Either way it gets pushed onto `sealedDocIds` so the reconciler
  // can replay post-seal writes from it during the grace window.
  const previousEntry = documentIndexState.value.index[options.key];
  const previousDocId = previousEntry?.currentDocId ?? String(deriveDocumentId(options.key));
  const nextSealed: string[] = previousEntry?.sealedDocIds ? [...previousEntry.sealedDocIds] : [];
  nextSealed.push(previousDocId);

  const indexHandle = documentIndexState.handle;
  if (!indexHandle) {
    throw new Error(
      'compactMeshDoc: documentIndexState.handle not bridged — caller must await documentIndexState.loaded before compacting'
    );
  }
  indexHandle.change((doc) => {
    if (!doc.index) {
      doc.index = {};
    }
    doc.index[options.key] = {
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
    };
  });

  return {
    key: options.key,
    previousDocId,
    newDocId: newDocIdString,
    removed,
    compactedAt,
  };
}

interface SnapshotOptions<TDoc extends MeshDoc> {
  /** The logical `$meshState` key being snapshotted. */
  key: string;
  /** Same Repo {@link compactMeshDoc} writes to. */
  repo: Repo;
  /** The current `$meshState` wrapper. Its `.value` is the
   * materialised state that becomes the new doc's initial content;
   * its `.handle` is where the sealed sentinel is written. */
  wrapper: {
    value: TDoc;
    readonly loaded: Promise<void>;
    readonly handle: DocHandle<TDoc> | undefined;
  };
}

/** Whole-doc snapshot — the no-filter sibling of
 * {@link compactMeshDoc}. Seeds a fresh doc with the wrapper's
 * current materialised state verbatim, then writes the sealed
 * sentinel + index entry so peers (and the in-process redirect
 * detector) follow the redirect to the new doc.
 *
 * Use this for heartbeat-style keys (`daemon:leader`,
 * `chat:health`, sessions, presence) where history is worthless —
 * only the current state matters — and the doc isn't shaped as an
 * entries map that {@link compactMeshDoc}'s filter API can target.
 * For entries-map docs with a "drop dead rows" policy
 * (`mesh:devices` dropping revoked entries) use
 * {@link compactMeshDoc} so the dead rows are filtered out, not
 * preserved verbatim. */
export async function snapshotMeshDoc<TDoc extends MeshDoc>(
  options: SnapshotOptions<TDoc>
): Promise<CompactionResult> {
  const identity = userIdentity.value;
  if (!identity) {
    throw new Error(
      'snapshotMeshDoc: no local user identity — bootstrap or import one before snapshotting.'
    );
  }

  await options.wrapper.loaded;
  const cleaned = options.wrapper.value;

  const compactedAt = new Date().toISOString();
  const versionedKey = `${options.key}:v${compactedAt}`;
  const newDocumentId = deriveDocumentId(versionedKey);
  const seeded = Automerge.save(Automerge.from(cleaned));
  const handle = options.repo.import(seeded, { docId: newDocumentId });
  handle.doneLoading();

  const newDocIdString = String(newDocumentId);
  const sentinel = buildSealedSentinel({
    migratedTo: newDocIdString,
    sealedAt: compactedAt,
    sealedBy: identity.userId,
  });
  const oldDocHandle = options.wrapper.handle;
  if (!oldDocHandle) {
    throw new Error(
      'snapshotMeshDoc: wrapper.handle not bridged — caller must await wrapper.loaded before snapshotting'
    );
  }
  oldDocHandle.change((doc: TDoc) => {
    (doc as Record<string, unknown>)[SEALED_SENTINEL_FIELD] = sentinel;
  });

  const previousEntry = documentIndexState.value.index[options.key];
  const previousDocId = previousEntry?.currentDocId ?? String(deriveDocumentId(options.key));
  const nextSealed: string[] = previousEntry?.sealedDocIds ? [...previousEntry.sealedDocIds] : [];
  nextSealed.push(previousDocId);

  const indexHandle = documentIndexState.handle;
  if (!indexHandle) {
    throw new Error(
      'snapshotMeshDoc: documentIndexState.handle not bridged — caller must await documentIndexState.loaded before snapshotting'
    );
  }
  indexHandle.change((doc) => {
    if (!doc.index) {
      doc.index = {};
    }
    doc.index[options.key] = {
      currentDocId: newDocIdString,
      sealedDocIds: nextSealed,
      compactedAt,
      compactedBy: identity.userId,
      signature: [],
    };
  });

  return {
    key: options.key,
    previousDocId,
    newDocId: newDocIdString,
    removed: 0,
    compactedAt,
  };
}

/** Count of Automerge changes in the wrapper's current document.
 * Each change is one increment of the doc's history, and polly's
 * NodeFS storage adapter writes ~one file per change to the
 * `incremental/` dir, so this count is a faithful proxy for "how
 * many incremental chunks does this doc carry on disk." Use it to
 * decide when a heartbeat-style doc has accumulated enough history
 * to be worth compacting (no historical value, only the current
 * state matters; the per-tick changes pile up unbounded).
 *
 * Returns 0 if the wrapper's handle hasn't bridged yet (caller
 * should await `wrapper.loaded` before reading). */
export function meshDocChangeCount<TDoc extends MeshDoc>(wrapper: {
  readonly handle: DocHandle<TDoc> | undefined;
}): number {
  const handle = wrapper.handle;
  if (!handle) {
    return 0;
  }
  let doc: TDoc | undefined;
  try {
    doc = handle.doc();
  } catch {
    return 0;
  }
  if (!doc) {
    return 0;
  }
  return Automerge.getAllChanges(doc as unknown as Automerge.Doc<TDoc>).length;
}

/** Result of a {@link reconcileMeshDoc} run. */
export interface ReconcileResult {
  /** The logical key reconciled. */
  key: string;
  /** Stringified DocumentId of the sealed doc that was read. */
  sealedDocId: string;
  /** Stringified DocumentId of the current doc the entries were
   * merged into. */
  currentDocId: string;
  /** Entries that survived the filter on the sealed doc AND were
   * absent from the current doc, so got copied across. */
  copied: number;
  /** Entries already present in the current doc (skipped). */
  skipped: number;
  /** Entries that didn't pass the keep filter on the sealed doc
   * (skipped — these are intentionally dropped by compaction). */
  filtered: number;
}

interface ReconcileOptions<TDoc extends MeshDoc, TEntry> {
  /** The logical key being reconciled. Must already have a
   * `mesh:document-index` entry — call after a successful
   * compaction. */
  key: string;
  /** Same Repo {@link compactMeshDoc} writes to. The reconciler
   * uses it to {@link Repo#find} both the sealed doc and the
   * current doc directly by their stored docIds — bypassing the
   * caller's `$meshState` wrapper, which may have been bound to
   * the old derived docId before the index hydrated. */
  repo: Repo;
  /** Extract the entry map from the doc shape. */
  selectEntries: (doc: TDoc) => Record<string, TEntry>;
  /** The same keep predicate the original compaction used.
   * Re-applied on the sealed doc's current state so resurrected
   * entries (e.g. a revoked row that got un-revoked) don't ride
   * along — the policy decision from compaction stays in force. */
  keep: (entry: TEntry) => boolean;
}

/** Manual grace-period reconciliation — ADR 0008 v3a slice.
 *
 * Reads the most-recent sealed doc's current state, applies the
 * keep predicate, and writes any entries the new doc is missing
 * into the new doc via the wrapper. Conservative: only adds
 * entries the new doc doesn't already have. Doesn't merge edits
 * to entries that exist in both — the genuinely-hard CRDT-merge
 * work where field-level edits on the sealed doc are propagated
 * is the deferred v3b piece, and the "skipped" count surfaces
 * how many entries fall into that bucket so the operator knows
 * whether a manual reconcile is worth doing.
 *
 * Idempotent: re-running with no post-seal writes copies zero
 * entries.
 *
 * Throws when there's no sealed doc in the index — i.e. the key
 * has never been compacted, so reconciliation is meaningless. */
export async function reconcileMeshDoc<TDoc extends MeshDoc, TEntry>(
  options: ReconcileOptions<TDoc, TEntry>
): Promise<ReconcileResult> {
  const indexEntry = documentIndexState.value.index[options.key];
  if (!indexEntry) {
    throw new Error(
      `reconcileMeshDoc: no mesh:document-index entry for "${options.key}" — run compact first.`
    );
  }
  const sealedIds = indexEntry.sealedDocIds;
  const mostRecentSealed = sealedIds[sealedIds.length - 1];
  if (!mostRecentSealed) {
    throw new Error(`reconcileMeshDoc: no sealed doc to reconcile from for "${options.key}".`);
  }

  // Load the sealed doc directly via repo.find. It's not the
  // current wrapper's docId so the wrapper doesn't help — but the
  // sealed doc's bytes are in local storage (synced before the
  // compaction landed) and Automerge's find resolves it.
  const { interpretAsDocumentId, isValidDocumentId } = await import(
    '@automerge/automerge-repo/slim'
  );
  if (!isValidDocumentId(mostRecentSealed)) {
    throw new Error(
      `reconcileMeshDoc: sealed docId "${mostRecentSealed}" is not a valid DocumentId.`
    );
  }
  const sealedDocId = interpretAsDocumentId(mostRecentSealed);
  const sealedHandle = await options.repo.find<TDoc>(sealedDocId, {
    allowableStates: ['ready', 'unavailable'],
  });
  const sealedDoc = sealedHandle.doc();
  if (!sealedDoc) {
    throw new Error(
      `reconcileMeshDoc: sealed doc "${mostRecentSealed}" failed to resolve to a state.`
    );
  }

  // Resolve the current doc by its stored docId rather than through
  // the `$meshState` wrapper. The wrapper's resolver fires at lazy
  // construction; if `documentIndexState` wasn't hydrated by then
  // the wrapper bound to the derived (old) docId and reads return
  // sealed-doc state. Going through `repo.find(currentDocId)` is
  // unambiguous.
  if (!isValidDocumentId(indexEntry.currentDocId)) {
    throw new Error(
      `reconcileMeshDoc: current docId "${indexEntry.currentDocId}" is not a valid DocumentId.`
    );
  }
  const currentDocId = interpretAsDocumentId(indexEntry.currentDocId);
  const currentHandle = await options.repo.find<TDoc>(currentDocId, {
    allowableStates: ['ready', 'unavailable'],
  });
  const currentDoc = currentHandle.doc();
  if (!currentDoc) {
    throw new Error(
      `reconcileMeshDoc: current doc "${indexEntry.currentDocId}" failed to resolve.`
    );
  }

  const currentEntries = options.selectEntries(currentDoc);
  const sealedEntries = options.selectEntries(sealedDoc);

  let copied = 0;
  let skipped = 0;
  let filtered = 0;
  const toCopy: [string, TEntry][] = [];
  for (const [entryKey, entry] of Object.entries(sealedEntries)) {
    if (!options.keep(entry)) {
      filtered += 1;
      continue;
    }
    if (entryKey in currentEntries) {
      skipped += 1;
      continue;
    }
    toCopy.push([entryKey, entry]);
    copied += 1;
  }

  if (toCopy.length > 0) {
    currentHandle.change((draft: TDoc) => {
      const live = options.selectEntries(draft);
      for (const [entryKey, entry] of toCopy) {
        live[entryKey] = entry;
      }
    });
  }

  return {
    key: options.key,
    sealedDocId: mostRecentSealed,
    currentDocId: indexEntry.currentDocId,
    copied,
    skipped,
    filtered,
  };
}
