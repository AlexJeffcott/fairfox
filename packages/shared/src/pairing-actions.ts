// Pairing action handlers — a registry fragment every sub-app spreads
// into its own action registry. Pairing is a mesh-wide concern (every
// sub-app shares the same keyring and peer set), so the same handlers
// run whether the user kicks off pairing from a todo-v2 banner, the
// agenda banner, or family-phone-admin.
//
// The wizard moves through two steps: issue this device's token, then
// scan the other device's token. Polly's pairing is asymmetric — each
// token only carries the issuer's identity — so both devices complete
// both halves to reach mutual trust.

import { loadOrCreateKeyring } from '#src/keyring.ts';
import { completePairing, initiatePairing } from '#src/pairing.ts';
import {
  issuedToken,
  knownPeerCount,
  pairingError,
  pairingMode,
  scanInput,
} from '#src/pairing-state.ts';

interface PairingHandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

export const pairingActions: Record<string, (ctx: PairingHandlerContext) => void> = {
  'pairing.start': () => {
    pairingMode.value = 'wizard-issue';
    pairingError.value = null;
    issuedToken.value = null;
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

  'pairing.next': () => {
    pairingMode.value = 'wizard-scan';
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
        knownPeerCount.value = keyring.knownPeers.size;
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
