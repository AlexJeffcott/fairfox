// Local pairing state — signals that hold the pairing token display and
// scan input while the pairing ceremony runs. The values are ephemeral
// (tokens expire within minutes and the mode returns to idle as soon as
// the ceremony completes or is cancelled), so they live as module-scoped
// signals rather than $meshState documents.
//
// Lifts what used to live in family-phone-admin so that every sub-app's
// pairing banner and the admin panel share the same state.

import { signal } from '@preact/signals';

export type PairingMode = 'idle' | 'issuing' | 'scanning';

export const pairingMode = signal<PairingMode>('idle');
export const issuedToken = signal<string | null>(null);
export const scanInput = signal<string>('');
export const pairingError = signal<string | null>(null);
