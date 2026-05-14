// Pre-boot side-effect module that configures the mesh Repo before any
// $meshState primitive is declared. Every sub-app's state.ts imports this
// file, so ESM's guaranteed module-init order — top-level await included —
// runs configureMeshState before the state module body evaluates.
//
// Without this, state.ts would call $meshState(...) at module top level and
// polly's resolveRepo() would throw because boot.tsx had not yet had a
// chance to set up the Repo.

import { interpretAsDocumentId, isValidDocumentId } from '@automerge/automerge-repo/slim';
import { registerDocIdResolver, registerRedirectDetector } from '@fairfox/polly/mesh';
import { currentDocIdForKey, DOCUMENT_INDEX_KEY } from '#src/document-index-state.ts';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { createMeshConnection, type MeshConnection } from '#src/mesh.ts';
import { getSealedSentinel } from '#src/sealed-sentinel.ts';

async function setup(): Promise<MeshConnection | undefined> {
  if (typeof window === 'undefined') {
    // Test and server environments configure their own Repo directly via
    // configureMeshState; there is no browser keyring or signaling URL to
    // read here.
    return undefined;
  }

  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const signalingUrl = `${proto}//${window.location.host}/polly/signaling`;

  return await createMeshConnection({ keyring, peerId, signalingUrl });
}

export const mesh: MeshConnection | undefined = await setup();

// ADR 0008: register a polly docId resolver that consults
// `mesh:document-index` for the currently-live docId per logical
// key. A key absent from the index resolves via polly's deterministic
// derive (legacy / never-compacted). The resolver short-circuits on
// the index doc's own key to avoid infinite recursion when its
// wrapper is itself being constructed.
//
// The resolver is registered after `setup()` so `configureMeshState`
// has run; the document-index wrapper's construction inside the
// resolver routes through the configured repo.
if (typeof window !== 'undefined' && mesh) {
  registerDocIdResolver((key) => {
    if (key === DOCUMENT_INDEX_KEY) {
      return undefined;
    }
    const stored = currentDocIdForKey(key);
    if (!stored || !isValidDocumentId(stored)) {
      return undefined;
    }
    try {
      return interpretAsDocumentId(stored);
    } catch {
      // The index carries a malformed entry — fall back to the
      // derived id rather than throw on every wrapper construction.
      return undefined;
    }
  });

  // ADR 0008 v3b: continuous redirect via the in-band sealed
  // sentinel. Runs on every doc change; if a peer-synced
  // `__compaction__` field appears on the doc the wrapper is
  // currently bound to, polly rebinds to the migrated-to docId
  // and the consumer signal re-fires with the new doc's state
  // — no reload needed. Works on devices whose
  // `mesh:document-index` hasn't synced yet, because the
  // sentinel rides on the sealed doc itself.
  registerRedirectDetector((doc) => {
    const sentinel = getSealedSentinel(doc);
    if (!sentinel) {
      return undefined;
    }
    if (!isValidDocumentId(sentinel.migratedTo)) {
      return undefined;
    }
    try {
      return interpretAsDocumentId(sentinel.migratedTo);
    } catch {
      return undefined;
    }
  });
}
