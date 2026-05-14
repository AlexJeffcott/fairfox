# 0008 — Document compaction via versioned docIds

**Status:** Accepted, partially implemented (v1 + v2 + v3a manual replay; CLI verbs wired, e2e at `scripts/e2e-mesh-compact-reconcile.ts`)
**Date:** 2026-05-14

## Context and problem statement

Every `$meshState` document is an Automerge CRDT. Automerge's
history is monotonic and tombstones are not garbage-collected;
deleted or revoked entries leave their operations behind in the
document forever. The bytes ride along on every sync message, every
peer's local storage, every backup export.

The 2026-05-14 bulk-revocation of 76 test-leftover device entries in
`mesh:devices` made the problem concrete. The browser hides revoked
rows; the CLI now does too (`web-v0.1.46`, CLI `v0.1.23`). But the
86 revoked rows still sit in the document, growing every sync
payload by their operation history. With nineteen pre-warmed
`$meshState` documents in the SPA and an open-ended growth curve
per document, the doc-size cost trends up monotonically.

`ENGINEERING_VISION.md` already names this as a known trade-off:

> Document growth. Automerge documents accumulate history;
> tombstones are not garbage-collected. Long-lived sub-apps will
> eventually want a compaction story — a periodic re-snapshot under
> a new document key with the old one archived — that has not been
> designed yet.

This ADR designs that compaction story.

## Decision drivers

- The mesh has no central authority. Compaction has to be safe
  against concurrent writes on any device, including offline ones
  that catch up after a long delay.
- Every paired device holds a full replica. A compaction that
  doubles storage briefly is acceptable; one that loses writes is
  not.
- The CLI runs out of `~/.fairfox/mesh/` as a NodeFS adapter; the
  browser runs out of IndexedDB. Both must execute the same
  compaction protocol.
- Polly's `$meshState` resolves a doc by deriving `documentId =
  hash(key)`. Two devices accessing the same key reach the same
  doc. The compaction protocol must hand that resolution path a
  way to find the "current" doc.
- A device that's been offline for months and reconnects must
  reach the post-compaction state without losing its offline
  writes.

## Decision

Introduce **versioned document keys**: each logical document key
(`mesh:devices`, `todo:tasks`, …) resolves to a chain of
Automerge documents, with the newest one as the "live" doc and
older ones as sealed snapshots. The mapping from key → current
docId lives in a small index document the platform reads at boot.

A compaction operation:

1. **Admin-triggered.** `fairfox mesh compact <key>` (CLI) or a
   button in the Help-tab admin panel (browser) starts a
   compaction. Requires the local user to hold a new
   `mesh.compact` permission.
2. **Snapshot.** Read the current doc's full materialised state
   (after the platform's normal filters: revoked rows omitted,
   etc.) and write the cleaned state into a new Automerge document
   with `documentId = hash(key + ':' + isoTimestamp)`. The seed is
   signed by the initiator under the same signature rules as a
   normal write.
3. **Index update.** Write a row into a new
   `mesh:document-index` document, keyed by logical doc key, with
   `{ currentDocId, sealedDocIds: [...], compactedAt, compactedBy
   }`. All peers read this index at boot to resolve which doc to
   open for a given key.
4. **Seal pointer.** Write a sentinel entry into the OLD doc:
   `{ __compaction__: { migratedTo: newDocId, sealedAt: ts,
   sealedBy: userId, signature: ... } }`. Devices that pick up the
   old doc first read this and follow the pointer to the new doc.
5. **Grace period.** Both docs stay open for syncing for a
   configurable window (default: 14 days). Writes that arrive at
   the old doc during the grace period are applied AND replayed
   into the new doc by any device that sees them; the migration
   logic uses Automerge's standard merge semantics, so a late
   write doesn't get lost.
6. **GC.** After the grace period, the old doc is removed from
   each device's storage on next compaction sweep. The
   `sealedDocIds` list in the index keeps a record of past docIds
   for forensic purposes.

`$meshState` is taught to consult `mesh:document-index` first when
resolving a key; the resolution happens at lazy-construction time
(inside `buildHandleFactory`) before `deriveDocumentId` falls back
to its current hash-of-key behaviour. Polly-side change.

> In the context of a household mesh where every device holds a
> full Automerge replica that grows monotonically with every write
> and revocation, facing the requirement that an admin must be
> able to compact a document without losing offline-pending writes
> and without coordinating every device simultaneously, we decided
> for versioned docIds resolved through a small index document
> with a grace-period dual-write window, against in-place
> tombstone GC inside Automerge or per-key partitioning, to
> achieve bounded document growth without sacrificing CRDT merge
> semantics or offline tolerance.

## Considered alternatives

- **In-place tombstone GC in Automerge.** Rejected — Automerge's
  CRDT semantics depend on the full history; you can't strip
  tombstones without changing the merge algorithm.
- **Per-key partitioning** (one Automerge doc per device entry,
  one per task, etc.). Rejected for the same-shape docs where the
  table-level operations (sort, filter) are how the UI reads;
  splitting into hundreds of docs makes every list view a
  hundred-doc gather. Worth revisiting for genuinely
  one-doc-per-thing use cases (e.g. per-chat-thread chat docs)
  but not the canonical mesh-state shape.
- **Periodic forced re-snapshot without an index doc.** Rejected
  because the resolution boot-path needs SOMETHING to tell it
  which docId is current; in-band sealing pointers only work if a
  device already has the old doc. A device joining for the first
  time after a compaction would never find the data.
- **Admin re-keys the mesh on compaction.** Considered, but a
  re-key requires every device to re-pair, which is heavier than
  the data growth it would solve. Compaction should be cheap; re-
  keying is for security incidents.

## Consequences

**Good:**
- Document growth is bounded by the operations between
  compactions, not by the lifetime of the mesh.
- Old data is archived rather than destroyed — the `sealedDocIds`
  index keeps a trail.
- Admins control the cadence; no automatic background process
  triggers a compaction.
- Offline writes during the grace period merge into both docs
  cleanly via Automerge's standard semantics.

**Bad:**
- Double-storage during the grace period (current size ×2 for
  ~14 days per compaction).
- A new `mesh:document-index` doc is itself a candidate for
  compaction; it's small enough that the trade-off is acceptable
  but introduces a recursive case to consider in tests.
- Polly's `$meshState` resolution gains an async hop on first
  access (read the index, then resolve the docId). Adds latency
  to cold-boot per-document hydration; cacheable in module scope
  after first read.
- Compaction is admin-only. A non-admin who notices their device
  has a 200MB `mesh:devices` doc has no remedy without going
  through someone with the role.
- Sync replay between old and new docs during the grace period
  doubles sync traffic per write. Acceptable at household scale,
  not at fleet scale.

## v1 implementation status (2026-05-14)

Shipped in v1 (the resolver + index + compaction surface):

- Polly 0.63.0: `registerDocIdResolver(fn)` hook in `mesh-state.ts`;
  `buildHandleFactory` consults `resolveDocumentId(key)` (resolver
  → derived) instead of `deriveDocumentId(key)` directly.
  `deriveDocumentId` is now an exported public helper so
  consumers can compute the same id polly does for arbitrary
  logical keys.
- fairfox: `mesh:document-index` `$meshState` wrapper holding
  `{ index: Record<key, { currentDocId, sealedDocIds[],
  compactedAt, compactedBy, signature }> }`.
- fairfox: resolver registration in both `ensure-mesh.ts` and
  `cli/src/mesh.ts`; both short-circuit on
  `mesh:document-index` to avoid recursion.
- fairfox: `compactMeshDoc<TDoc, TEntry>` primitive in
  `shared/src/compact-mesh-doc.ts` — reads current state via the
  consumer's wrapper, applies a keep predicate, seeds the
  cleaned state at `deriveDocumentId(key + ':v' +
  isoTimestamp)`, writes the index row.
- fairfox: `fairfox mesh compact <key>` CLI command. Currently
  supports `mesh:devices` only (keep predicate: `!revokedAt`);
  any other key returns an "unsupported" error pending its
  selector / predicate / buildDoc registration.
- fairfox: `mesh.compact` permission added to the Permission
  union and admin role's permission set.

Shipped in v2 (sealed-pointer sentinel — `shared/src/sealed-sentinel.ts`):

- `__compaction__` field stamped on the OLD doc by
  `compactMeshDoc` on every compaction. Payload:
  `{ migratedTo, sealedAt, sealedBy, signature }`. The
  reserved field name and the doc-shape `[key: string]: unknown`
  index signature mean consumers don't need to widen any
  existing TypeScript shape; the sentinel rides on the same
  CRDT writes the rest of the doc uses.
- `getSealedSentinel(doc)` / `isSealedDoc(doc)` /
  `buildSealedSentinel({ … })` helpers from
  `@fairfox/shared/sealed-sentinel`. Consumers reading any
  `$meshState` doc can detect that the doc has been sealed and
  follow the pointer without needing to consult the index.
- The sentinel and the matching index entry are written from
  the same `compactMeshDoc` call with the same `compactedAt`
  timestamp, so cross-checking the two surfaces is mechanical.

Shipped in v3a (manual grace-period reconcile):

- `reconcileMeshDoc<TDoc, TEntry>(...)` primitive in
  `shared/src/compact-mesh-doc.ts`. Reads the most-recent sealed
  doc via `repo.find(sealedDocId)` (bypassing the `$meshState`
  wrapper, which may have bound to the old derived docId before
  the index hydrated), reapplies the keep predicate, and writes
  any entries the new doc is missing into the new doc through
  `currentHandle.change`. Idempotent: re-running with no
  post-seal writes copies zero entries.
- `fairfox mesh reconcile <key>` CLI verb wired through
  `bin.ts → commands/mesh.ts → reconcileMeshDoc`. Same
  permission gate as `mesh compact` (`mesh.compact` permission,
  admin role). Reports `copied / skipped / filtered` counts.
- End-to-end test at `scripts/e2e-mesh-compact-reconcile.ts`
  drives the full path: init admin → compact → inspect index +
  sentinel → programmatic post-seal write into the sealed doc
  → reconcile → assert the post-seal entry reached the new doc
  → second reconcile asserts idempotency.

The CLI compact/reconcile flow surfaced (and fixed) two latent
bugs the pre-v2 ship had hidden:

- `compactMeshDoc` depended on the browser-side
  `ensure-mesh.ts` module-global `mesh`, which is always
  undefined in the CLI. Refactored both primitives to take an
  explicit `repo: Repo` option; callers pass `client.repo` from
  their `openMeshClient` / `mesh.repo` from `ensure-mesh`.
- The CLI never hydrated `userIdentity.value` (browser hydrates
  from IDB; CLI persists to a file but never wrote into the
  signal). `canDo('mesh.compact')` and the sentinel-stamping
  step both depend on the signal. Both verbs now mirror the
  file-backed identity into the signal before the gate fires,
  and await `usersState.loaded` + `devicesState.loaded` so the
  permission walk runs against hydrated state.

Deferred to v3b (the genuinely-hard CRDT-merge work):

- **Field-level merge on entries that exist in both docs.**
  Today `reconcileMeshDoc` only copies entries that are absent
  from the new doc; it doesn't merge field-level edits made on
  the sealed doc to entries that exist in both. An offline peer
  who edited an existing entry on the sealed doc post-seal sees
  their edit dropped on reconcile. The `skipped` count in the
  CLI output surfaces how many entries fall into this bucket so
  an operator can spot when manual intervention is needed.
- **Automatic GC.** After the grace window, sealed docs are
  removed from each device's storage. Needs a polly-side
  `repo.removeFromStorage(docId)` primitive that doesn't exist
  yet.
- **Browser admin button.** A Help-tab admin control that fires
  the compaction action without a CLI. Same logic as
  `meshCompact`.
- **Index-row + sentinel signing + strict verification.** Both
  surfaces carry an empty signature in v2. The strict path
  needs to sign each on write and verify on read, refusing
  redirects backed by malformed evidence. The two surfaces
  need to be signed together (each unsigned-with-other-signed
  state is exploitable).

## Open questions, deferred to implementation

- Whether the index doc lives alongside `mesh:meta` or stands
  alone.
- What the right grace-period default is — 14 days is a guess;
  could be one day for fast-moving sub-apps, longer for archival
  docs.
- Whether to expose a "preview compaction size delta" command so
  the admin sees how much data the compaction will reclaim
  before triggering it.
- The polly-side `$meshState` resolution hook needs care to not
  break boot when the index doc itself hasn't loaded yet —
  probably a "until the index resolves, use the legacy docId"
  fallback.
- Compaction interplay with the storage-write atomicity polly
  0.62.0 added: compaction should commit the new doc's seed and
  the index update in a single transaction at each storage adapter.
