// Local pairing state — signals that drive the mesh gate and the
// pairing ceremony behind it. Pairing is asymmetric: a token carries
// only the issuer's identity, so both devices must issue and scan to
// reach mutual trust. The state below tracks which halves this device
// has yet to complete, the artefacts the issuing device shows to the
// world (token, QR, share URL), and the buffer for a scanned token.
//
// meshGateOpen is satisfied either by a peer known to the keyring or
// by an explicit "this device is solo" acknowledgement that persists
// through reloads. soloDeviceMode hydrates from localStorage the first
// time the gate mounts.

import { computed, signal } from '@preact/signals';

export type PairingMode = 'idle' | 'wizard-issue' | 'wizard-scan';
export type PairingStep = 'issue' | 'scan';

const SOLO_STORAGE_KEY = 'fairfox:solo-device';

export const pairingMode = signal<PairingMode>('idle');
export const pairingStepsRemaining = signal<ReadonlySet<PairingStep>>(new Set());
export const issuedToken = signal<string | null>(null);
export const issuedQr = signal<string | null>(null);
export const issuedShareUrl = signal<string | null>(null);
export const scanInput = signal<string>('');
export const pairingError = signal<string | null>(null);
export const knownPeerCount = signal<number | null>(null);
export const soloDeviceMode = signal<boolean>(false);

export const meshGateOpen = computed(() => {
  if (knownPeerCount.value === null) {
    return false;
  }
  return knownPeerCount.value > 0 || soloDeviceMode.value;
});

export function hydrateSoloDeviceMode(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    soloDeviceMode.value = window.localStorage.getItem(SOLO_STORAGE_KEY) === 'true';
  } catch {
    soloDeviceMode.value = false;
  }
}

export function persistSoloDeviceMode(value: boolean): void {
  soloDeviceMode.value = value;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (value) {
      window.localStorage.setItem(SOLO_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(SOLO_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable in private mode; the in-memory
    // signal still satisfies the gate for the lifetime of the session.
  }
}
