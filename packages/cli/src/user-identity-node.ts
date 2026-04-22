// CLI-side user-identity storage. Mirrors the browser's
// `@fairfox/shared/user-identity` (IndexedDB at `fairfox-user-identity`)
// with a file at `~/.fairfox/user-identity.json` so the CLI can
// participate in the users+permissions flow: `fairfox users bootstrap`
// creates the first admin, `fairfox users import-recovery` brings an
// existing user key onto a new CLI install, and `fairfox users
// invite | revoke | whoami` can all sign with the local key.
//
// The JSON shape matches the browser's `PersistedUserIdentity` so a
// single recovery blob carries an identity across any device type.
// The on-disk file is chmodded 0600 after write — losing this file
// to a reader means losing the user key.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isRecord, type SigningKeyPair, signingKeyPairFromSecret } from '@fairfox/shared/polly';
import {
  decodeRecoveryBlob,
  exportRecoveryBlob,
  signEndorsement,
  type UserIdentity,
} from '@fairfox/shared/user-identity';
import { encodePublicKeyHex } from '@fairfox/shared/users-state';

export const USER_IDENTITY_PATH = join(homedir(), '.fairfox', 'user-identity.json');

interface PersistedUserIdentity {
  /** Hex userId for quick inspection; authoritative value is the
   * derived public key. */
  userId: string;
  /** Secret key as number[] so the file is plain JSON, no base64
   * round-trip required. */
  secretKey: number[];
  displayName: string;
}

function rematerialise(persisted: PersistedUserIdentity): UserIdentity {
  const keypair = signingKeyPairFromSecret(new Uint8Array(persisted.secretKey));
  return {
    userId: persisted.userId,
    displayName: persisted.displayName,
    keypair,
  };
}

function writeAtomic(path: string, payload: PersistedUserIdentity): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // chmod is best-effort; on some filesystems (FAT, network
    // mounts) the perm bits are meaningless.
  }
  // rename is atomic on POSIX within a filesystem.
  renameSync(tmp, path);
}

export function loadUserIdentityFile(): UserIdentity | undefined {
  if (!existsSync(USER_IDENTITY_PATH)) {
    return undefined;
  }
  const raw = readFileSync(USER_IDENTITY_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isPersistedShape(parsed)) {
    throw new Error('user-identity file is malformed');
  }
  return rematerialise(parsed);
}

function isPersistedShape(value: unknown): value is PersistedUserIdentity {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.userId === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.secretKey)
  );
}

export function saveUserIdentityFile(identity: UserIdentity): void {
  const payload: PersistedUserIdentity = {
    userId: identity.userId,
    displayName: identity.displayName,
    secretKey: Array.from(identity.keypair.secretKey),
  };
  writeAtomic(USER_IDENTITY_PATH, payload);
}

export function clearUserIdentityFile(): void {
  if (!existsSync(USER_IDENTITY_PATH)) {
    return;
  }
  unlinkSync(USER_IDENTITY_PATH);
}

export function createUserIdentityFile(displayName: string, keypair: SigningKeyPair): UserIdentity {
  const identity: UserIdentity = {
    userId: encodePublicKeyHex(keypair.publicKey),
    displayName,
    keypair,
  };
  saveUserIdentityFile(identity);
  return identity;
}

/** Import a recovery blob into the local file store. Returns the
 * materialised identity. Throws if the blob is malformed or if an
 * identity is already present (refuse to clobber by accident). */
export function importRecoveryFile(blob: string, opts: { force?: boolean } = {}): UserIdentity {
  if (!opts.force && existsSync(USER_IDENTITY_PATH)) {
    throw new Error(
      `a user identity already exists at ${USER_IDENTITY_PATH}. Pass --force to overwrite.`
    );
  }
  const identity = decodeRecoveryBlob(blob);
  saveUserIdentityFile(identity);
  return identity;
}

export { decodeRecoveryBlob, exportRecoveryBlob, signEndorsement };
