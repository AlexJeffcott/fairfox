// Pairing action handlers — a registry fragment every sub-app spreads
// into its own action registry. Because pairing is a cross-cutting mesh
// concern (every sub-app uses the same keyring and peer set), the same
// handlers run whether the user kicks off pairing from a todo-v2 banner,
// the agenda banner, or the family-phone-admin panel.

import { loadOrCreateKeyring } from '#src/keyring.ts';
import { completePairing, initiatePairing } from '#src/pairing.ts';
import { issuedToken, pairingError, pairingMode, scanInput } from '#src/pairing-state.ts';

interface PairingHandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

export const pairingActions: Record<string, (ctx: PairingHandlerContext) => void> = {
  'pairing.issue': () => {
    pairingMode.value = 'issuing';
    pairingError.value = null;
    (async () => {
      try {
        const keyring = await loadOrCreateKeyring();
        const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        issuedToken.value = initiatePairing(keyring, peerId);
      } catch (err) {
        pairingError.value = err instanceof Error ? err.message : String(err);
        pairingMode.value = 'idle';
      }
    })();
  },

  'pairing.scan': () => {
    pairingMode.value = 'scanning';
    scanInput.value = '';
    pairingError.value = null;
  },

  'pairing.submit-scan': (ctx) => {
    const encoded = ctx.data.value;
    if (!encoded) {
      return;
    }
    (async () => {
      try {
        const keyring = await loadOrCreateKeyring();
        await completePairing(keyring, encoded);
        pairingMode.value = 'idle';
        issuedToken.value = null;
        scanInput.value = '';
      } catch (err) {
        pairingError.value = err instanceof Error ? err.message : String(err);
      }
    })();
  },

  'pairing.cancel': () => {
    pairingMode.value = 'idle';
    issuedToken.value = null;
    scanInput.value = '';
    pairingError.value = null;
  },
};
