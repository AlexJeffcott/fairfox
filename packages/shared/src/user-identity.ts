// User identity — the per-human Ed25519 keypair that identifies a
// person across all of their devices. Distinct from the polly
// `MeshKeyring` (which holds the per-device mesh identity); a user
// can hold keys on multiple devices, and a device can hold *no* user
// key at all if it's a shared tablet that the owner hasn't added
// themselves to yet.
//
// Storage: same IndexedDB database as the keyring, separate object
// store key. A fresh install has no user identity; one is created at
// the "Who are you?" wizard (Phase B) or imported from a recovery
// blob (Phase C).

import type { SigningKeyPair } from '@fairfox/polly/mesh';
import { generateSigningKeyPair, sign, signingKeyPairFromSecret } from '@fairfox/polly/mesh';
import { encodePublicKeyHex } from '#src/users-state.ts';

const DB_NAME = 'fairfox-keyring';
const STORE_NAME = 'keyring';
const USER_KEY = 'user-identity';

interface PersistedUserIdentity {
  secretKey: number[];
  displayName: string;
}

export interface UserIdentity {
  userId: string;
  displayName: string;
  keypair: SigningKeyPair;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      // See keyring.ts's openDb for why the contains() guard is
      // load-bearing — both modules race to upgrade the same DB on
      // fresh install, and the unguarded createObjectStore throws
      // ConstraintError on the losing racer, leaving the DB in a
      // half-upgraded state.
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
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
    const req = tx.objectStore(STORE_NAME).get(key);
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
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(key);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

function toIdentity(secretKey: Uint8Array, displayName: string): UserIdentity {
  const keypair = signingKeyPairFromSecret(secretKey);
  return {
    userId: encodePublicKeyHex(keypair.publicKey),
    displayName,
    keypair,
  };
}

/** Load the user identity from IndexedDB. Returns undefined when no
 * user key is present — the caller shows the "Who are you?" wizard. */
export async function loadUserIdentity(): Promise<UserIdentity | undefined> {
  if (typeof indexedDB === 'undefined') {
    return undefined;
  }
  const db = await openDb();
  try {
    const data = await idbGet<PersistedUserIdentity>(db, USER_KEY);
    if (!data) {
      return undefined;
    }
    return toIdentity(new Uint8Array(data.secretKey), data.displayName);
  } finally {
    db.close();
  }
}

/** Persist a user identity to IndexedDB. Called by the wizard after
 * successful creation or import. */
export async function saveUserIdentity(identity: UserIdentity): Promise<void> {
  const db = await openDb();
  try {
    const payload: PersistedUserIdentity = {
      secretKey: Array.from(identity.keypair.secretKey),
      displayName: identity.displayName,
    };
    await idbPut(db, USER_KEY, payload);
  } finally {
    db.close();
  }
}

/** Wipe the user identity from IndexedDB. Used by the
 * leave-a-shared-device flow and by tests that need a clean slate. */
export async function clearUserIdentity(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  const db = await openDb();
  try {
    await idbDelete(db, USER_KEY);
  } finally {
    db.close();
  }
}

/** Fresh-mesh / fresh-device case. Generate a new keypair and
 * persist. Returns the identity so the caller can write the
 * bootstrap `UserEntry`. */
export async function createUserIdentity(displayName: string): Promise<UserIdentity> {
  const keypair = generateSigningKeyPair();
  const identity: UserIdentity = {
    userId: encodePublicKeyHex(keypair.publicKey),
    displayName,
    keypair,
  };
  await saveUserIdentity(identity);
  return identity;
}

// --- Recovery blob -----------------------------------------------
//
// The recovery blob is how a user carries their identity between
// devices (e.g. phone → tablet, or "I got a new laptop"). Shape:
// `fairfox-user-v1:<hex-secret-key>:<urlencoded-displayname>`.
// We avoid JSON because the blob is shown to the user in a copy-
// paste box; a compact text format reads better and is easier to
// re-type in an emergency.
//
// Carries the full 64-byte secret key. Anyone who holds the blob
// holds the user key — store it like a password.

const RECOVERY_PREFIX = 'fairfox-user-v1';

export function exportRecoveryBlob(identity: UserIdentity): string {
  const secretHex = Array.from(identity.keypair.secretKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${RECOVERY_PREFIX}:${secretHex}:${encodeURIComponent(identity.displayName)}`;
}

/** Decode a recovery blob into a `UserIdentity` without touching
 * IndexedDB. Pure function — safe to call in tests and on the CLI.
 * Throws on malformed input. */
export function decodeRecoveryBlob(blob: string): UserIdentity {
  const trimmed = blob.trim();
  const parts = trimmed.split(':');
  const prefix = parts[0];
  const secretHex = parts[1];
  const displayNameEncoded = parts[2];
  if (
    parts.length !== 3 ||
    prefix === undefined ||
    secretHex === undefined ||
    displayNameEncoded === undefined
  ) {
    throw new Error('decodeRecoveryBlob: unrecognised blob format');
  }
  if (prefix !== RECOVERY_PREFIX) {
    throw new Error('decodeRecoveryBlob: unrecognised blob format');
  }
  if (secretHex.length !== 128) {
    throw new Error('decodeRecoveryBlob: secret key wrong length');
  }
  const secretKey = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    const byte = Number.parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('decodeRecoveryBlob: malformed secret key hex');
    }
    secretKey[i] = byte;
  }
  const displayName = decodeURIComponent(displayNameEncoded);
  return toIdentity(secretKey, displayName);
}

/** Decode a recovery blob and persist the resulting identity to
 * IndexedDB. Browser-only — falls back to throwing on non-browser
 * environments. */
export async function importRecoveryBlob(blob: string): Promise<UserIdentity> {
  const identity = decodeRecoveryBlob(blob);
  await saveUserIdentity(identity);
  return identity;
}

// --- Endorsement helpers -----------------------------------------

export interface Endorsement {
  userId: string;
  /** Hex-encoded 64-byte Ed25519 signature over
   * `{ deviceId, userId, addedAt }`. */
  signature: number[];
  addedAt: string;
}

/** Produce an endorsement of `deviceId` by this user identity. The
 * caller writes the result onto the target device's `mesh:devices`
 * row. Used for self-endorsement at bootstrap and for the "add me to
 * a shared device" flow. */
export function signEndorsement(identity: UserIdentity, deviceId: string): Endorsement {
  const addedAt = new Date().toISOString();
  const payload = new TextEncoder().encode(
    JSON.stringify({ deviceId, userId: identity.userId, addedAt })
  );
  const signature = sign(payload, identity.keypair.secretKey);
  return {
    userId: identity.userId,
    signature: Array.from(signature),
    addedAt,
  };
}
