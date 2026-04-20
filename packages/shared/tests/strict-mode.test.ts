// Strict-mode gating tests — exercise the read-time verification
// helpers directly so we don't need a live mesh Repo. The full
// effectivePermissionsForDevice path is covered by the e2e drill in
// Phase H once the mesh is wired.

import { afterEach, describe, expect, test } from 'bun:test';
import { generateSigningKeyPair, sign } from '@fairfox/polly/mesh';
import { setStrictMode } from '#src/strict-mode.ts';
import { encodePublicKeyHex, verifiedEndorsementUserIds } from '#src/users-state.ts';

afterEach(() => {
  setStrictMode(false);
});

function validEndorsement(deviceId: string): {
  userId: string;
  signature: number[];
  addedAt: string;
} {
  const keypair = generateSigningKeyPair();
  const userId = encodePublicKeyHex(keypair.publicKey);
  const addedAt = '2026-04-20T00:00:00.000Z';
  const payload = new TextEncoder().encode(JSON.stringify({ deviceId, userId, addedAt }));
  const signature = sign(payload, keypair.secretKey);
  return { userId, signature: Array.from(signature), addedAt };
}

describe('verifiedEndorsementUserIds', () => {
  test('returns only valid endorsers under strict mode', () => {
    setStrictMode(true);
    const good = validEndorsement('dev-1');
    const tampered = { ...validEndorsement('dev-1'), userId: 'a'.repeat(64) };
    const result = verifiedEndorsementUserIds([good, tampered], 'dev-1');
    expect(result).toEqual([good.userId]);
  });

  test('returns all endorsers under lenient mode (default)', () => {
    setStrictMode(false);
    const good = validEndorsement('dev-1');
    const tampered = { ...validEndorsement('dev-1'), userId: 'a'.repeat(64) };
    const result = verifiedEndorsementUserIds([good, tampered], 'dev-1');
    expect(result.length).toBe(2);
    expect(result).toContain(good.userId);
  });

  test('drops endorsement with malformed userId under strict mode', () => {
    setStrictMode(true);
    const result = verifiedEndorsementUserIds(
      [{ userId: 'not-hex', signature: [], addedAt: '2026-04-20T00:00:00.000Z' }],
      'dev-1'
    );
    expect(result).toHaveLength(0);
  });

  test('empty or undefined endorsements produces empty list', () => {
    setStrictMode(true);
    expect(verifiedEndorsementUserIds([], 'dev-1')).toHaveLength(0);
    expect(verifiedEndorsementUserIds(undefined, 'dev-1')).toHaveLength(0);
  });
});
