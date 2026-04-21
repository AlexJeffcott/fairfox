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

/** Draft for the name this device will announce into `mesh:devices` when
 * it first enters the pairing ceremony. Prefilled from the user agent on
 * the browser side; the CLI writes its own default (hostname) directly
 * rather than going through the wizard. */
export const deviceNameDraft = signal<string>('');

/** Signalling session id attached to the current issue-mode token.
 * Generated at `pair-issue` time, appended to the share URL as `&s=…`,
 * echoed by the scanner in its `pair-return` frame. Null when no
 * ceremony is in progress or the issue step has not yet started. */
export const pairingSessionId = signal<string | null>(null);

/** True while the issuer's wizard is waiting for the scanner's
 * reciprocal token to arrive over the signalling socket. The wizard's
 * UI uses this to show a passive "waiting for the other device…"
 * line under the QR. */
export const issuerWaitingForReturn = signal<boolean>(false);

/** True while the in-app camera QR scanner modal is open. Lives in
 * this file rather than `qr-scan.tsx` so the `pairingActions` handler
 * can toggle it without a circular import. */
export const cameraScanOpen = signal<boolean>(false);

export type InviteRole = 'admin' | 'member' | 'guest';

/** Draft state for the "also invite a user" toggle in the issue
 * wizard. `inviteDraftEnabled` flips the toggle; `inviteDraftName`
 * carries the invitee's display name; `inviteDraftRole` is the role
 * they'll be granted. When the issuer regenerates the share URL,
 * these are consulted to decide whether to attach an `&invite=…`
 * segment. */
export const inviteDraftEnabled = signal<boolean>(false);
export const inviteDraftName = signal<string>('');
export const inviteDraftRole = signal<InviteRole>('member');
/** Last-generated invite blob for the current pairing session. Kept
 * so the UI can show a short confirmation ("invited Leo as member")
 * next to the share URL without re-encoding. */
export const inviteIssuedBlob = signal<string | null>(null);
export const inviteIssuedName = signal<string | null>(null);

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
