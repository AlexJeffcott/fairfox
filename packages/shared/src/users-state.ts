// Users state — the self-declared registry of every human (or
// automated service) who holds keys in this mesh. Each user has a
// display name, an Ed25519 identity (the hex-encoded public key is
// both the stable `userId` and the verification key), a role set,
// and optional fine-grained grants. Writes are signed by the creating
// user's key (Phase F enforces this cryptographically; Phase A–E
// accept lenient unsigned writes during migration).
//
// Schema lock: polly's `$meshState` is first-writer-wins for schema.
// The target shape is baked in on day one — roles and grants include
// every field a later phase will need, so a partial rollout doesn't
// freeze a narrower shape.
//
// Binary fields (signatures) are stored as `number[]` because
// Automerge documents don't round-trip `Uint8Array` reliably across
// every transport. Every read site must convert back with
// `new Uint8Array(arr)` before calling polly's `verify`.

import { $meshState, type SigningKeyPair, sign, verify } from '@fairfox/polly/mesh';
import '@fairfox/shared/ensure-mesh';
import { logLenientViolation, strictMode } from '#src/strict-mode.ts';

interface UsersPrimitive {
  value: UsersDoc;
  readonly loaded: Promise<void>;
}

/** A role groups a collection of permissions for the common case.
 * Fine-grained grants compose on top. */
export type Role = 'admin' | 'member' | 'guest' | 'llm';

/** Every action that a user might need permission to perform. Closed
 * set — adding one requires shipping a new fairfox release so every
 * peer knows how to evaluate it. */
export type Permission =
  | 'user.invite'
  | 'user.revoke'
  | 'user.grant-role'
  | 'device.pair'
  | 'device.rename'
  | 'device.revoke'
  | 'device.designate-llm'
  | 'subapp.install'
  | 'todo.write'
  | 'agenda.write'
  | 'agenda.complete-other';

/** A fine-grained grant on top of the user's role set. The optional
 * `scope` narrows the grant to a specific sub-resource (e.g. a
 * project id) — unused today, reserved so the shape is stable. */
export interface Grant {
  permission: Permission;
  scope?: string;
}

export interface UserEntry {
  /** Hex-encoded 32-byte Ed25519 public key. Acts as the user's
   * stable id and the verification key — decode with
   * `decodeUserPublicKey(userId)`. */
  userId: string;
  /** Human-readable display name. */
  displayName: string;
  /** Roles held by this user. `admin` subsumes every permission. */
  roles: Role[];
  /** Per-permission grants composed on top of role permissions. */
  grants: Grant[];
  /** The user that created this row. Self for the bootstrap user. */
  createdByUserId: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** 64-byte Ed25519 signature over the canonical serialisation of
   * the row (all fields above), by the `createdByUserId`'s user key.
   * Phase F verifies it; Phase A–E accept rows with empty signature
   * during the lenient migration window. */
  signature: number[];
  /** ISO 8601 timestamp set when the user is revoked. A revoked
   * user's permission set is empty. */
  revokedAt?: string;
  /** Signature over `{ userId, revokedAt }` by the revoking user's
   * key. Phase F verifies the revoker holds `user.revoke`. */
  revocationSignature?: number[];
  /** The user that signed the revocation, if any. */
  revokedByUserId?: string;
}

export interface UsersDoc {
  [key: string]: unknown;
  users: Record<string, UserEntry>;
}

let _usersPrimitive: UsersPrimitive | null = null;

function primitive(): UsersPrimitive {
  if (_usersPrimitive === null) {
    _usersPrimitive = $meshState<UsersDoc>('mesh:users', { users: {} });
  }
  return _usersPrimitive;
}

export const usersState: UsersPrimitive = {
  get value(): UsersDoc {
    return primitive().value;
  },
  set value(next: UsersDoc) {
    primitive().value = next;
  },
  get loaded(): Promise<void> {
    return primitive().loaded;
  },
};

/** Hex-encode a public key (or any byte buffer) for use as a stable
 * id. Lower-case, no separators. */
export function encodePublicKeyHex(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decode a hex-encoded user id back to the raw 32-byte public key.
 * Returns undefined if the input isn't a well-formed hex string of
 * the right length — caller treats that as "user is not in this
 * mesh's user registry." */
export function decodeUserPublicKey(userId: string): Uint8Array | undefined {
  if (userId.length !== 64) {
    return undefined;
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    const byte = Number.parseInt(userId.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      return undefined;
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Canonical byte encoding used for signing and verifying a user row.
 * Stable field order so a row signed on one device verifies on every
 * other device that reconstructs the same bytes. */
function encodeUserForSigning(
  entry: Pick<
    UserEntry,
    'userId' | 'displayName' | 'roles' | 'grants' | 'createdByUserId' | 'createdAt'
  >
): Uint8Array {
  const canonical = JSON.stringify({
    userId: entry.userId,
    displayName: entry.displayName,
    roles: entry.roles,
    grants: entry.grants,
    createdByUserId: entry.createdByUserId,
    createdAt: entry.createdAt,
  });
  return new TextEncoder().encode(canonical);
}

function encodeRevocationForSigning(userId: string, revokedAt: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ userId, revokedAt }));
}

export interface CreateBootstrapUserOptions {
  displayName: string;
  userKey: SigningKeyPair;
}

/** Create the first admin user on a fresh mesh. The user self-signs
 * their own row; `createdByUserId` is the same as `userId`. */
export function createBootstrapUser(options: CreateBootstrapUserOptions): UserEntry {
  const userId = encodePublicKeyHex(options.userKey.publicKey);
  const roles: Role[] = ['admin'];
  const grants: Grant[] = [];
  const draft = {
    userId,
    displayName: options.displayName,
    roles,
    grants,
    createdByUserId: userId,
    createdAt: new Date().toISOString(),
  };
  const signature = sign(encodeUserForSigning(draft), options.userKey.secretKey);
  const entry: UserEntry = { ...draft, signature: Array.from(signature) };
  usersState.value = {
    ...usersState.value,
    users: { ...usersState.value.users, [userId]: entry },
  };
  return entry;
}

export interface UpsertUserOptions {
  /** User being written. Must include `signature` set to a valid
   * signature by `createdByUserId`'s user key, or an empty array to
   * opt into lenient mode (Phase F will reject this). */
  entry: UserEntry;
}

export function upsertUser(options: UpsertUserOptions): void {
  usersState.value = {
    ...usersState.value,
    users: { ...usersState.value.users, [options.entry.userId]: options.entry },
  };
}

export interface SetGrantsOptions {
  userId: string;
  grants: Grant[];
  granterUserId: string;
  granterUserKey: SigningKeyPair;
}

/** Overwrite a user's grants list with a new set, re-signed by the
 * granter. The row's `createdByUserId` is updated to the granter so
 * the new signature verifies under the right key; the original
 * `createdAt` is preserved so the provenance timeline isn't lost.
 * Callers gate on the granter holding `user.grant-role` before
 * invoking. */
export function setUserGrants(options: SetGrantsOptions): void {
  const existing = usersState.value.users[options.userId];
  if (!existing) {
    throw new Error(`setUserGrants: unknown userId ${options.userId}`);
  }
  const createdAt = existing.createdAt;
  const draft = {
    userId: options.userId,
    displayName: existing.displayName,
    roles: existing.roles,
    grants: options.grants,
    createdByUserId: options.granterUserId,
    createdAt,
  };
  const signature = sign(encodeUserForSigning(draft), options.granterUserKey.secretKey);
  const next: UserEntry = {
    ...existing,
    grants: options.grants,
    createdByUserId: options.granterUserId,
    signature: Array.from(signature),
  };
  usersState.value = {
    ...usersState.value,
    users: { ...usersState.value.users, [options.userId]: next },
  };
}

export interface RevokeUserOptions {
  userId: string;
  revokerUserId: string;
  revokerUserKey: SigningKeyPair;
}

export function revokeUser(options: RevokeUserOptions): void {
  const existing = usersState.value.users[options.userId];
  if (!existing) {
    throw new Error(`revokeUser: unknown userId ${options.userId}`);
  }
  const revokedAt = new Date().toISOString();
  const revocationSignature = sign(
    encodeRevocationForSigning(options.userId, revokedAt),
    options.revokerUserKey.secretKey
  );
  const next: UserEntry = {
    ...existing,
    revokedAt,
    revokedByUserId: options.revokerUserId,
    revocationSignature: Array.from(revocationSignature),
  };
  usersState.value = {
    ...usersState.value,
    users: { ...usersState.value.users, [options.userId]: next },
  };
}

/** Verify that a user row's `signature` was produced by the expected
 * signer (either self, for a bootstrap row, or `createdByUserId`'s
 * user key). Returns false on missing signature or malformed id. */
export function verifyUserSignature(entry: UserEntry): boolean {
  if (entry.signature.length === 0) {
    return false;
  }
  const signerId = entry.createdByUserId;
  const signerPublicKey = decodeUserPublicKey(signerId);
  if (!signerPublicKey) {
    return false;
  }
  if (signerId !== entry.userId) {
    const signer = usersState.value.users[signerId];
    if (!signer || signer.revokedAt) {
      return false;
    }
  }
  return verify(encodeUserForSigning(entry), new Uint8Array(entry.signature), signerPublicKey);
}

/** Verify a user row's revocation against the recorded revoker. */
export function verifyUserRevocation(entry: UserEntry): boolean {
  if (!entry.revokedAt || !entry.revocationSignature || !entry.revokedByUserId) {
    return false;
  }
  const revokerPublicKey = decodeUserPublicKey(entry.revokedByUserId);
  if (!revokerPublicKey) {
    return false;
  }
  return verify(
    encodeRevocationForSigning(entry.userId, entry.revokedAt),
    new Uint8Array(entry.revocationSignature),
    revokerPublicKey
  );
}

/** Look up a non-revoked user by id. Returns undefined for revoked
 * users so callers can treat "revoked" as "gone" at the reading
 * layer.
 *
 * Under strict mode the signature is also verified and a failing
 * row is treated as absent; under lenient mode a failing row passes
 * through but logs a warning via `logLenientViolation`. This is the
 * load-bearing read gate — every downstream helper
 * (`permissionsForUser`, `canDo`, `effectivePermissionsForDevice`)
 * goes through `liveUser`, so flipping strict-mode flips enforcement
 * for the whole policy surface. */
export function liveUser(userId: string): UserEntry | undefined {
  const entry = usersState.value.users[userId];
  if (!entry) {
    return undefined;
  }
  if (entry.revokedAt) {
    return undefined;
  }
  if (!verifyUserSignature(entry)) {
    if (strictMode.value) {
      return undefined;
    }
    logLenientViolation('unsigned user row accepted', { userId });
  }
  return entry;
}

/** Verify every endorsement on a device row against the endorser's
 * public key. Under strict mode, returns only endorsements whose
 * signature passes; under lenient mode, returns the full list but
 * logs each failure. */
export function verifiedEndorsementUserIds(
  endorsements: { userId: string; signature: number[]; addedAt: string }[] | undefined,
  deviceId: string
): string[] {
  if (!endorsements || endorsements.length === 0) {
    return [];
  }
  const strict = strictMode.value;
  const kept: string[] = [];
  for (const endorsement of endorsements) {
    const endorserKey = decodeUserPublicKey(endorsement.userId);
    if (!endorserKey) {
      if (!strict) {
        logLenientViolation('endorsement with malformed userId', {
          deviceId,
          userId: endorsement.userId,
        });
        kept.push(endorsement.userId);
      }
      continue;
    }
    const payload = new TextEncoder().encode(
      JSON.stringify({
        deviceId,
        userId: endorsement.userId,
        addedAt: endorsement.addedAt,
      })
    );
    const ok = verify(payload, new Uint8Array(endorsement.signature), endorserKey);
    if (ok) {
      kept.push(endorsement.userId);
      continue;
    }
    if (!strict) {
      logLenientViolation('endorsement signature invalid', {
        deviceId,
        userId: endorsement.userId,
      });
      kept.push(endorsement.userId);
    }
  }
  return kept;
}
