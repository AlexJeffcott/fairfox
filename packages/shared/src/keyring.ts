// Keyring management for fairfox — create, load, and persist a MeshKeyring
// to IndexedDB so that each device has a stable Ed25519 identity across
// sessions. The keyring holds the device's signing key pair, the public
// keys of every trusted peer, the symmetric document encryption key, and
// the set of revoked peers. See ADR 0003 for the rationale.
//
// IndexedDB is the storage layer because it is the only browser API that
// survives page reloads, works in both main threads and service workers,
// and can hold binary data (Uint8Array) without base64 encoding.

import type { MeshKeyring } from '@fairfox/polly/mesh';
import {
  DEFAULT_MESH_KEY_ID,
  generateDocumentKey,
  generateSigningKeyPair,
  signingKeyPairFromSecret,
} from '@fairfox/polly/mesh';

const DB_NAME = 'fairfox-keyring';
const STORE_NAME = 'keyring';
const KEY = 'default';

interface PersistedKeyring {
  identitySecret: number[];
  knownPeers: [string, number[]][];
  documentKeys: [string, number[]][];
  revokedPeers: string[];
  revocationAuthority: string[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

function serialise(keyring: MeshKeyring): PersistedKeyring {
  return {
    identitySecret: Array.from(keyring.identity.secretKey),
    knownPeers: Array.from(keyring.knownPeers.entries()).map(([id, pk]) => [id, Array.from(pk)]),
    documentKeys: Array.from(keyring.documentKeys.entries()).map(([id, dk]) => [
      id,
      Array.from(dk),
    ]),
    revokedPeers: Array.from(keyring.revokedPeers),
    revocationAuthority: keyring.revocationAuthority ? Array.from(keyring.revocationAuthority) : [],
  };
}

function deserialise(data: PersistedKeyring): MeshKeyring {
  const secretKey = new Uint8Array(data.identitySecret);
  const identity = signingKeyPairFromSecret(secretKey);
  return {
    identity,
    knownPeers: new Map(data.knownPeers.map(([id, pk]) => [id, new Uint8Array(pk)])),
    documentKeys: new Map(data.documentKeys.map(([id, dk]) => [id, new Uint8Array(dk)])),
    revokedPeers: new Set(data.revokedPeers),
    revocationAuthority:
      data.revocationAuthority.length > 0 ? new Set(data.revocationAuthority) : undefined,
  };
}

export function createKeyring(): MeshKeyring {
  const identity = generateSigningKeyPair();
  const documentKey = generateDocumentKey();
  return {
    identity,
    knownPeers: new Map(),
    documentKeys: new Map([[DEFAULT_MESH_KEY_ID, documentKey]]),
    revokedPeers: new Set(),
    revocationAuthority: undefined,
  };
}

export async function loadKeyring(): Promise<MeshKeyring | null> {
  const db = await openDb();
  try {
    const data = await idbGet<PersistedKeyring>(db, KEY);
    if (!data) {
      return null;
    }
    return deserialise(data);
  } finally {
    db.close();
  }
}

export async function saveKeyring(keyring: MeshKeyring): Promise<void> {
  const db = await openDb();
  try {
    await idbPut(db, KEY, serialise(keyring));
  } finally {
    db.close();
  }
}

export async function loadOrCreateKeyring(): Promise<MeshKeyring> {
  const existing = await loadKeyring();
  if (existing) {
    return existing;
  }
  const fresh = createKeyring();
  await saveKeyring(fresh);
  return fresh;
}

/** Stop syncing with a peer on THIS device. Removes the peer from the
 * trust set and adds it to the revoked-peers set so polly's network
 * adapter refuses further messages from it. Persists the change.
 *
 * The scope is local: other paired devices still have the forgotten
 * peer in their own keyrings and still share mesh documents with it.
 * A mesh-wide revocation would rotate the shared mesh keys and
 * propagate through a signed `createRevocation` envelope — separate
 * design, not this helper.
 *
 * Callers must trigger a `window.location.reload()` after this
 * resolves. The mesh client was constructed at module load time with
 * the old known-peer set; without a reload the WebRTC adapter will
 * still try to reach the forgotten peer on the next reconnect.
 */
export async function forgetPeer(keyring: MeshKeyring, peerId: string): Promise<void> {
  const { revokePeerLocally } = await import('@fairfox/polly/mesh');
  revokePeerLocally(peerId, keyring);
  keyring.knownPeers.delete(peerId);
  await saveKeyring(keyring);
}
