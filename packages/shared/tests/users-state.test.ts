// Round-trip tests for the cryptographic primitives in users-state
// and user-identity. Deliberately does NOT boot a mesh Repo — the
// signing/verify/encoding helpers are pure and testable in isolation.

import { describe, expect, test } from 'bun:test';
import { generateSigningKeyPair, sign, verify } from '@fairfox/polly/mesh';
import { decodeRecoveryBlob, exportRecoveryBlob, signEndorsement } from '#src/user-identity.ts';
import {
  decodeUserPublicKey,
  encodePublicKeyHex,
  type UserEntry,
  verifyUserRevocation,
  verifyUserSignature,
} from '#src/users-state.ts';

function canonicalEncode(
  entry: Pick<
    UserEntry,
    'userId' | 'displayName' | 'roles' | 'grants' | 'createdByUserId' | 'createdAt'
  >
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      userId: entry.userId,
      displayName: entry.displayName,
      roles: entry.roles,
      grants: entry.grants,
      createdByUserId: entry.createdByUserId,
      createdAt: entry.createdAt,
    })
  );
}

describe('users-state', () => {
  test('encodePublicKeyHex / decodeUserPublicKey round-trip', () => {
    const keypair = generateSigningKeyPair();
    const hex = encodePublicKeyHex(keypair.publicKey);
    expect(hex).toHaveLength(64);
    const decoded = decodeUserPublicKey(hex);
    expect(decoded).toBeDefined();
    if (!decoded) {
      throw new Error('unreachable');
    }
    expect(Array.from(decoded)).toEqual(Array.from(keypair.publicKey));
  });

  test('decodeUserPublicKey rejects malformed input', () => {
    expect(decodeUserPublicKey('not-hex')).toBeUndefined();
    expect(decodeUserPublicKey('a'.repeat(63))).toBeUndefined();
    expect(decodeUserPublicKey(`${'z'.repeat(64)}`)).toBeUndefined();
  });

  test('verifyUserSignature accepts a well-formed self-signed bootstrap row', () => {
    const keypair = generateSigningKeyPair();
    const userId = encodePublicKeyHex(keypair.publicKey);
    const draft = {
      userId,
      displayName: 'Alex',
      roles: ['admin' as const],
      grants: [],
      createdByUserId: userId,
      createdAt: '2026-04-20T10:00:00.000Z',
    };
    const signature = sign(canonicalEncode(draft), keypair.secretKey);
    const entry: UserEntry = { ...draft, signature: Array.from(signature) };
    expect(verifyUserSignature(entry)).toBe(true);
  });

  test('verifyUserSignature rejects a row with tampered displayName', () => {
    const keypair = generateSigningKeyPair();
    const userId = encodePublicKeyHex(keypair.publicKey);
    const draft = {
      userId,
      displayName: 'Alex',
      roles: ['admin' as const],
      grants: [],
      createdByUserId: userId,
      createdAt: '2026-04-20T10:00:00.000Z',
    };
    const signature = sign(canonicalEncode(draft), keypair.secretKey);
    const tampered: UserEntry = {
      ...draft,
      displayName: 'Mallory',
      signature: Array.from(signature),
    };
    expect(verifyUserSignature(tampered)).toBe(false);
  });

  test('verifyUserSignature rejects an empty signature', () => {
    const keypair = generateSigningKeyPair();
    const userId = encodePublicKeyHex(keypair.publicKey);
    const entry: UserEntry = {
      userId,
      displayName: 'Alex',
      roles: ['admin'],
      grants: [],
      createdByUserId: userId,
      createdAt: '2026-04-20T10:00:00.000Z',
      signature: [],
    };
    expect(verifyUserSignature(entry)).toBe(false);
  });

  test('verifyUserRevocation accepts a signature by the recorded revoker', () => {
    const revokerKey = generateSigningKeyPair();
    const revokerUserId = encodePublicKeyHex(revokerKey.publicKey);
    const targetKey = generateSigningKeyPair();
    const targetUserId = encodePublicKeyHex(targetKey.publicKey);
    const revokedAt = '2026-04-21T09:00:00.000Z';
    const revocationPayload = new TextEncoder().encode(
      JSON.stringify({ userId: targetUserId, revokedAt })
    );
    const sig = sign(revocationPayload, revokerKey.secretKey);
    // Sanity: verify directly against the revoker's public key.
    expect(verify(revocationPayload, sig, revokerKey.publicKey)).toBe(true);
    const entry: UserEntry = {
      userId: targetUserId,
      displayName: 'Guest',
      roles: ['guest'],
      grants: [],
      createdByUserId: revokerUserId,
      createdAt: '2026-04-20T10:00:00.000Z',
      signature: [],
      revokedAt,
      revocationSignature: Array.from(sig),
      revokedByUserId: revokerUserId,
    };
    expect(verifyUserRevocation(entry)).toBe(true);
  });
});

describe('user-identity', () => {
  test('recovery blob round-trip preserves keypair and displayName', () => {
    const keypair = generateSigningKeyPair();
    const userId = encodePublicKeyHex(keypair.publicKey);
    const identity = { userId, displayName: 'Alex', keypair };
    const blob = exportRecoveryBlob(identity);
    expect(blob.startsWith('fairfox-user-v1:')).toBe(true);

    const imported = decodeRecoveryBlob(blob);
    expect(imported.userId).toBe(userId);
    expect(imported.displayName).toBe('Alex');
    expect(Array.from(imported.keypair.secretKey)).toEqual(Array.from(keypair.secretKey));
  });

  test('decodeRecoveryBlob rejects malformed input', () => {
    expect(() => decodeRecoveryBlob('not-a-blob')).toThrow();
    expect(() => decodeRecoveryBlob('fairfox-user-v1:tooshort:Alex')).toThrow();
    expect(() => decodeRecoveryBlob('fairfox-user-v2:abc:Alex')).toThrow();
  });

  test('signEndorsement produces a signature that verifies under the user key', () => {
    const keypair = generateSigningKeyPair();
    const userId = encodePublicKeyHex(keypair.publicKey);
    const identity = { userId, displayName: 'Alex', keypair };
    const deviceId = 'device-abc';
    const endorsement = signEndorsement(identity, deviceId);
    const payload = new TextEncoder().encode(
      JSON.stringify({ deviceId, userId, addedAt: endorsement.addedAt })
    );
    expect(verify(payload, new Uint8Array(endorsement.signature), keypair.publicKey)).toBe(true);
  });
});
