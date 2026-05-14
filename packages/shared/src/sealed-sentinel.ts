// Sealed-doc sentinel — ADR 0008 v2 slice.
//
// When `fairfox mesh compact <key>` runs, the old document gets a
// `__compaction__` field stamped on it that names the new docId
// and the timestamp the seal took effect. Peers that read the old
// doc directly — typically because their `mesh:document-index` is
// stale — can detect the sentinel and follow the pointer to the
// current doc.
//
// The sentinel is asymmetric with the index entry: the index is
// the global "where does key K resolve right now" surface; the
// sentinel is the per-doc "I'm no longer current, here's where
// to look" surface. Either piece of evidence is sufficient to
// redirect a reader; both exist to handle the gap between
// "consumer's wrapper has bound to the old doc" and "consumer's
// index has hydrated with the redirect".
//
// Strict-verification of the sentinel signature rides on the
// matching strict-verification of the index entry — v2 stamps the
// signer's userId but leaves the signature byte array empty until
// the strict-mode work lands.

/** Reserved field name on every `$meshState` doc shape. Consumers
 * with their own `[key: string]: unknown` index signature pick it
 * up transparently. */
export const SEALED_SENTINEL_FIELD = '__compaction__' as const;

/** Payload of the sealed sentinel. Mirror of the matching
 * `mesh:document-index` row for the same logical key — readers
 * cross-check the two surfaces before trusting the redirect. */
export interface SealedSentinel {
  [key: string]: unknown;
  /** Stringified `DocumentId` of the cleaned doc that replaces
   * this one. The current resolver routes future
   * `$meshState(key)` constructions here once the index has
   * hydrated. */
  migratedTo: string;
  /** ISO 8601 timestamp at which the seal took effect. Writes
   * to this doc dated after `sealedAt` are post-seal and would
   * be replayed into the new doc by the grace-period reconciler
   * (v3 — deferred). */
  sealedAt: string;
  /** Hex-encoded `userId` of the admin who triggered the
   * compaction. Same identity as the matching index entry's
   * `compactedBy`. */
  sealedBy: string;
  /** Signature over the row's canonical bytes by the
   * `sealedBy` user key. Empty in v2 — the strict-verification
   * path waits on the matching strict-mode work for the index
   * row's signature (ADR 0008 deferred). */
  signature: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Type guard. Returns the sentinel object when the doc carries a
 * structurally-valid sentinel; `undefined` otherwise.
 *
 * Lenient mode: doesn't verify the signature. The strict variant
 * lives on the verification side once signing is enforced. */
export function getSealedSentinel(doc: unknown): SealedSentinel | undefined {
  if (!isRecord(doc)) {
    return undefined;
  }
  const raw = doc[SEALED_SENTINEL_FIELD];
  if (!isRecord(raw)) {
    return undefined;
  }
  const { migratedTo, sealedAt, sealedBy, signature } = raw;
  if (typeof migratedTo !== 'string') {
    return undefined;
  }
  if (typeof sealedAt !== 'string') {
    return undefined;
  }
  if (typeof sealedBy !== 'string') {
    return undefined;
  }
  if (!Array.isArray(signature)) {
    return undefined;
  }
  return {
    migratedTo,
    sealedAt,
    sealedBy,
    signature: signature.filter((b): b is number => typeof b === 'number'),
  };
}

/** Whether a doc has been sealed. Convenience over
 * {@link getSealedSentinel}. */
export function isSealedDoc(doc: unknown): boolean {
  return getSealedSentinel(doc) !== undefined;
}

/** Build a fresh sentinel for the current compaction. Lenient
 * mode — `signature` is the empty array until strict-mode work
 * lands. */
export function buildSealedSentinel(args: {
  migratedTo: string;
  sealedAt: string;
  sealedBy: string;
}): SealedSentinel {
  return {
    migratedTo: args.migratedTo,
    sealedAt: args.sealedAt,
    sealedBy: args.sealedBy,
    signature: [],
  };
}
