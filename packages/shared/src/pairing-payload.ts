// pairing-payload — encrypts the identity blob an issuer hands a joining
// device once the pairing handshake completes.
//
// The identity blob (a recovery blob for "add my own device", or an
// admin-signed invite blob for "invite a new person") used to ride the
// QR/share-URL directly. That made the QR carry a permanent secret — the
// user's user-secret-key — and pushed the QR to a module count an iPad
// camera could not resolve.
//
// The redesign keeps identity out of the QR entirely. The QR carries only
// transport (pair token + session id) plus one ephemeral key `k`. The
// issuer encrypts the identity blob under `k` and delivers the ciphertext
// over the relay's pair-ack frame. `k` lives only in the QR, which is
// scanned camera-to-camera and never reaches the relay — so the relay
// forwards ciphertext it cannot read, and an attacker who injects a
// pair-return on a sniffed session id gets a pair-ack it cannot decrypt.
// `k` is ephemeral (born when the QR opens, dies when it closes), so it
// is a transient join credential, not a permanent secret.

import { decrypt, encrypt, generateDocumentKey } from '@fairfox/polly/mesh';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** Mint a fresh ephemeral key for one pairing ceremony. base64url so it
 * drops into a URL fragment without escaping. 32 bytes — a secretbox key,
 * minted the same way as a document key. */
export function generateAckKey(): string {
  return toBase64Url(generateDocumentKey());
}

/** Encrypt an identity blob under the ephemeral ack key. The result is
 * standard base64 — it travels as a JSON string field (`payload`) on the
 * pair-ack signalling frame. */
export function encryptPairingPayload(blob: string, ackKey: string): string {
  const sealed = encrypt(new TextEncoder().encode(blob), fromBase64Url(ackKey));
  return toBase64(sealed);
}

/** Decrypt a pair-ack `payload` back into the identity blob. Throws if the
 * key is wrong or the ciphertext is malformed — call sites surface that as
 * "the issuer could not hand us an identity; fall back to the wizard". */
export function decryptPairingPayload(payload: string, ackKey: string): string {
  const opened = decrypt(fromBase64(payload), fromBase64Url(ackKey));
  if (!opened) {
    throw new Error('pairing payload: could not decrypt — wrong key or corrupt ciphertext');
  }
  return new TextDecoder().decode(opened);
}
