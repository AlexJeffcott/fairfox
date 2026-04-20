// Unit tests for the invite blob round-trip. No mesh boot — verifies
// the signed-envelope shape in isolation.

import { describe, expect, test } from 'bun:test';
import { generateSigningKeyPair } from '@fairfox/polly/mesh';
import { createInvite, decodeInviteBlob, verifyInviteSignature } from '#src/invite.ts';
import { encodePublicKeyHex } from '#src/users-state.ts';

describe('invite', () => {
  test('round-trip: decoded invite matches the admin-signed payload', () => {
    const adminKey = generateSigningKeyPair();
    const adminUserId = encodePublicKeyHex(adminKey.publicKey);
    const { blob, payload } = createInvite({
      displayName: 'Leo',
      roles: ['guest'],
      adminUserKey: adminKey,
      adminUserId,
    });
    const decoded = decodeInviteBlob(blob);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.displayName).toBe('Leo');
    expect(decoded.roles).toEqual(['guest']);
    expect(decoded.createdByUserId).toBe(adminUserId);
    expect(decoded.secretKey).toEqual(payload.secretKey);
    expect(verifyInviteSignature(decoded, adminKey.publicKey)).toBe(true);
  });

  test('verifyInviteSignature rejects tampered role escalation', () => {
    const adminKey = generateSigningKeyPair();
    const adminUserId = encodePublicKeyHex(adminKey.publicKey);
    const { blob } = createInvite({
      displayName: 'Leo',
      roles: ['guest'],
      adminUserKey: adminKey,
      adminUserId,
    });
    const decoded = decodeInviteBlob(blob);
    decoded.roles = ['admin'];
    expect(verifyInviteSignature(decoded, adminKey.publicKey)).toBe(false);
  });

  test('verifyInviteSignature rejects a signature from a different admin', () => {
    const adminKey = generateSigningKeyPair();
    const otherAdminKey = generateSigningKeyPair();
    const adminUserId = encodePublicKeyHex(adminKey.publicKey);
    const { blob } = createInvite({
      displayName: 'Leo',
      roles: ['member'],
      adminUserKey: adminKey,
      adminUserId,
    });
    const decoded = decodeInviteBlob(blob);
    expect(verifyInviteSignature(decoded, otherAdminKey.publicKey)).toBe(false);
  });

  test('decodeInviteBlob rejects malformed input', () => {
    expect(() => decodeInviteBlob('not-an-invite')).toThrow();
    expect(() => decodeInviteBlob('fairfox-invite-v1:not-base64')).toThrow();
    expect(() => decodeInviteBlob('fairfox-invite-v2:abc')).toThrow();
  });
});
