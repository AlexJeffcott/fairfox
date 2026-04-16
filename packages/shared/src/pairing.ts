// Pairing and revocation flow for fairfox — wraps polly's pairing token
// and revocation primitives with keyring persistence so the application
// doesn't have to remember to save after every mutation. See ADR 0003.
//
// The flow:
//   1. Trusted device calls initiatePairing() → gets a base64 string to
//      display as a QR code.
//   2. New device scans the QR, calls completePairing() → the pairing
//      token is applied to the new device's keyring and persisted.
//   3. If a device is compromised, Alex calls revokeDevice() on any
//      trusted device → a signed revocation record propagates to every
//      peer on the next sync.

import type { MeshKeyring } from '@fairfox/polly/mesh';
import {
  applyPairingToken,
  applyRevocation,
  createPairingToken,
  createRevocation,
  DEFAULT_MESH_KEY_ID,
  decodePairingToken,
  encodePairingToken,
} from '@fairfox/polly/mesh';
import { saveKeyring } from './keyring.ts';

export function initiatePairing(keyring: MeshKeyring, peerId: string): string {
  const token = createPairingToken({
    identity: keyring.identity,
    issuerPeerId: peerId,
    documentKey: keyring.documentKeys.get(DEFAULT_MESH_KEY_ID),
    documentKeyId: DEFAULT_MESH_KEY_ID,
  });
  return encodePairingToken(token);
}

export async function completePairing(keyring: MeshKeyring, encodedToken: string): Promise<void> {
  const token = decodePairingToken(encodedToken);
  applyPairingToken(token, keyring);
  await saveKeyring(keyring);
}

export async function revokeDevice(
  keyring: MeshKeyring,
  revokedPeerId: string,
  issuerPeerId: string
): Promise<void> {
  const record = createRevocation({
    issuer: keyring.identity,
    issuerPeerId,
    revokedPeerId,
  });
  applyRevocation(record, keyring);
  await saveKeyring(keyring);
}
