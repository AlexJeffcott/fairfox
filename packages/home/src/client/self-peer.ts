// selfPeerId — the browser's own peer id, derived from the keyring's
// public key on first mount and stashed in a signal so PeersView can
// flag the current device's row without awaiting the keyring on every
// render. Populated by boot.tsx after the keyring is loaded.

import { signal } from '@preact/signals';

export const selfPeerId = signal<string | null>(null);

export function setSelfPeerId(peerId: string): void {
  selfPeerId.value = peerId;
}
