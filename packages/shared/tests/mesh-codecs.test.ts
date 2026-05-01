// Round-trip tests for the binary codecs polly's mesh transport
// builds on. These are pure functions — no I/O, no Repo — so they
// belong at the unit tier where a 60-second e2e timeout would be
// the only other signal.
//
// Tier-1 mutation testing surfaced that an off-by-one in
// `decodeSignedEnvelope`'s byte-offset parsing (round-4 mutation
// B18) sails past every higher-tier test we have and only manifests
// as a 60-second relay timeout. A round-trip assertion on each
// codec catches that family in <1 s. We exercise the codecs that
// are part of polly's public mesh API: encrypt/decrypt and the
// pairing-token serialisation pair.

import { describe, expect, test } from 'bun:test';
import {
  decodePairingToken,
  decrypt,
  decryptOrThrow,
  EncryptionError,
  encodePairingToken,
  encrypt,
  generateDocumentKey,
  generateSigningKeyPair,
  PAIRING_TOKEN_VERSION,
  PairingError,
  type PairingToken,
  parsePairingToken,
  serialisePairingToken,
} from '@fairfox/polly/mesh';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

describe('mesh codec round-trips', () => {
  test('encrypt → decrypt recovers the original payload', () => {
    const key = generateDocumentKey();
    const payload = new TextEncoder().encode('hello, mesh');
    const sealed = encrypt(payload, key);
    const recovered = decrypt(sealed, key);
    expect(recovered).toBeDefined();
    expect(recovered).toEqual(payload);
  });

  test('decrypt with the wrong key returns undefined', () => {
    const key = generateDocumentKey();
    const otherKey = generateDocumentKey();
    const payload = new TextEncoder().encode('secret');
    const sealed = encrypt(payload, key);
    expect(decrypt(sealed, otherKey)).toBeUndefined();
    expect(() => decryptOrThrow(sealed, otherKey)).toThrow(EncryptionError);
  });

  test('decrypt rejects a one-byte-truncated ciphertext', () => {
    const key = generateDocumentKey();
    const sealed = encrypt(new TextEncoder().encode('payload'), key);
    const truncated = sealed.slice(0, sealed.length - 1);
    expect(decrypt(truncated, key)).toBeUndefined();
  });

  test('encrypt produces a payload that is NOT byte-identical to plaintext', () => {
    // Round-2 mutation B6 disabled encryption (`sealEnvelope` returned
    // plaintext). The e2e tier caught it as "no replication" — the
    // wire bytes were wrong. A unit-tier check that ciphertext is
    // structurally distinct from plaintext catches the same mutation
    // in <1 s and identifies it specifically as an encryption-layer
    // regression rather than a generic sync failure.
    const key = generateDocumentKey();
    const payload = new TextEncoder().encode('plain payload bytes');
    const sealed = encrypt(payload, key);
    expect(sealed.length).toBeGreaterThan(payload.length);
    let identicalPrefix = 0;
    const limit = Math.min(payload.length, sealed.length);
    for (let i = 0; i < limit; i += 1) {
      if (sealed[i] === payload[i]) {
        identicalPrefix += 1;
      } else {
        break;
      }
    }
    // Heuristic: the nonce prefix is 24 random bytes, so the chance
    // of even the first byte matching is 1/256. Asserting <8 bytes
    // of leading equality is a robust gate against "encryption is
    // a no-op" without flaking on legitimate cipher output.
    expect(identicalPrefix).toBeLessThan(8);
  });

  test('serialisePairingToken → parsePairingToken preserves every field', () => {
    const issuer = generateSigningKeyPair();
    const documentKey = generateDocumentKey();
    const nonce = randomBytes(16);
    const original: PairingToken = {
      version: PAIRING_TOKEN_VERSION,
      issuerPeerId: 'issuer-peer-id',
      issuerPublicKey: issuer.publicKey,
      documentKey,
      documentKeyId: 'polly-mesh-default',
      expiresAt: 1_777_000_000_000,
      nonce,
    };
    const bytes = serialisePairingToken(original);
    const parsed = parsePairingToken(bytes);
    expect(parsed.version).toBe(original.version);
    expect(parsed.issuerPeerId).toBe(original.issuerPeerId);
    expect(parsed.issuerPublicKey).toEqual(original.issuerPublicKey);
    expect(parsed.documentKey).toEqual(original.documentKey);
    expect(parsed.documentKeyId).toBe(original.documentKeyId);
    expect(parsed.expiresAt).toBe(original.expiresAt);
    expect(parsed.nonce).toEqual(original.nonce);
  });

  test('encodePairingToken → decodePairingToken round-trips through base64', () => {
    const issuer = generateSigningKeyPair();
    const original: PairingToken = {
      version: PAIRING_TOKEN_VERSION,
      issuerPeerId: 'issuer-peer-id',
      issuerPublicKey: issuer.publicKey,
      documentKey: generateDocumentKey(),
      documentKeyId: 'polly-mesh-default',
      expiresAt: 1_777_000_000_000,
      nonce: randomBytes(16),
    };
    const encoded = encodePairingToken(original);
    expect(typeof encoded).toBe('string');
    const decoded = decodePairingToken(encoded);
    expect(decoded.issuerPeerId).toBe(original.issuerPeerId);
    expect(decoded.issuerPublicKey).toEqual(original.issuerPublicKey);
    expect(decoded.documentKey).toEqual(original.documentKey);
    expect(decoded.expiresAt).toBe(original.expiresAt);
  });

  test('parsePairingToken rejects a one-byte-truncated buffer', () => {
    const issuer = generateSigningKeyPair();
    const token: PairingToken = {
      version: PAIRING_TOKEN_VERSION,
      issuerPeerId: 'p',
      issuerPublicKey: issuer.publicKey,
      documentKey: generateDocumentKey(),
      documentKeyId: 'k',
      expiresAt: 1,
      nonce: randomBytes(16),
    };
    const bytes = serialisePairingToken(token);
    const truncated = bytes.slice(0, bytes.length - 1);
    expect(() => parsePairingToken(truncated)).toThrow(PairingError);
  });
});
