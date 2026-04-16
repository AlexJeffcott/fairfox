// Local pairing state — a module-scoped signal holding the pairing
// token display/scan state. Not a $meshState because the token is
// ephemeral (TTL of minutes) and only relevant to the local device
// during the pairing ceremony.

import { signal } from '@preact/signals';

export type PairingMode = 'idle' | 'issuing' | 'scanning';

export const pairingMode = signal<PairingMode>('idle');
export const issuedToken = signal<string | null>(null);
export const scanInput = signal<string>('');
export const pairingError = signal<string | null>(null);
