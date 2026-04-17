// Local pairing state — signals that drive the pairing ceremony. The
// ceremony is a two-step wizard because polly's pairing is asymmetric:
// a token only carries the issuer's identity, so both devices have to
// issue and scan each other's tokens to end up with mutual trust.
//
// Step 1 ('wizard-issue'): this device's token is shown on screen and
//   the user shares it out of band (QR scan, paste) with the other
//   device.
// Step 2 ('wizard-scan'): this device reads the token issued by the
//   other device. On success the keyring gains the other peer and the
//   banner's knownPeerCount rises above zero, which hides the banner.
//
// knownPeerCount also lives here so pairing-actions can bump it from
// the submit-scan handler without the banner having to poll IndexedDB.

import { signal } from '@preact/signals';

export type PairingMode = 'idle' | 'wizard-issue' | 'wizard-scan';

export const pairingMode = signal<PairingMode>('idle');
export const issuedToken = signal<string | null>(null);
export const scanInput = signal<string>('');
export const pairingError = signal<string | null>(null);
export const knownPeerCount = signal<number | null>(null);
