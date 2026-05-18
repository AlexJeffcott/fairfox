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
import { configureMeshState, Repo } from '#src/polly-reexport.ts';
import { getSealedSentinel } from '#src/sealed-sentinel.ts';

const mark = (label: string): void => {
  const fn = (globalThis as unknown as { __mark?: (s: string) => void }).__mark;
  if (typeof fn === 'function') {
    fn(label);
  }
};

async function setup(): Promise<MeshConnection | undefined> {
  if (typeof window === 'undefined') {
    // Test and server environments configure their own Repo directly via
    // configureMeshState; there is no browser keyring or signaling URL to
    // read here.
    return undefined;
  }

  mark('ensure-mesh: setup start');
  const keyring = await loadOrCreateKeyring();
  mark('ensure-mesh: keyring loaded');
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const signalingUrl = `${proto}//${window.location.host}/polly/signaling`;

  const conn = await createMeshConnection({ keyring, peerId, signalingUrl });
  mark('ensure-mesh: mesh connection ready');
  return conn;
}

/** Stand up an empty, network-less, storage-less Repo and register it
 * with polly's `$meshState` module so wrapper construction succeeds.
 * Used only when {@link setup} rejects: every sub-app's state module
 * calls `$meshState(...)` at the top level, and polly throws
 * synchronously when no Repo is configured — without this fallback,
 * a transient keyring hiccup (e.g. another fairfox tab holding the
 * IDB open) escalates from "no mesh, show recovery UI" to "uncaught
 * throw in module init, white screen of death".
 *
 * Wrappers attached to this stub Repo are inert: they don't persist,
 * they don't sync, they hold the initial value handed to the
 * `$meshState(key, initial)` call. That is the *correct* shape for
 * the failure path: the App boots, MeshGate sees no peers and no
 * paired state, the user gets the LoginPage / recovery affordance. */
function installStubRepoForFailedSetup(): void {
  try {
    configureMeshState(new Repo({ network: [] }));
    mark('ensure-mesh: stub Repo installed');
  } catch (err) {
    console.error('[ensure-mesh] stub Repo configure failed:', err);
  }
}

// Never reject the top-level await. ensure-mesh is imported (directly
// or transitively) by every sub-app's state module, so a rejection
// here cascades into the bundle's import graph and the entire SPA
// fails to evaluate — the page goes blank with no actionable signal.
// Returning `undefined` lets the bundle finish loading and the App
// render; MeshGate then surfaces the unpaired/unconfigured state to
// the user with a recovery affordance.
export const mesh: MeshConnection | undefined = await setup().catch((err) => {
  console.error('[ensure-mesh] setup() failed; continuing without mesh:', err);
  mark(`ensure-mesh: setup rejected: ${err instanceof Error ? err.message : String(err)}`);
  installStubRepoForFailedSetup();
  return undefined;
});

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
