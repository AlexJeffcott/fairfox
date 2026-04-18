// Pairing action handlers — a registry fragment every sub-app spreads
// into its own action registry. Pairing is a mesh-wide concern (every
// sub-app shares the same keyring and peer set), so the same handlers
// run whether the user kicks off pairing from a todo-v2 banner, the
// agenda banner, or family-phone-admin.
//
// The ceremony has two halves — issue this device's token, scan the
// other device's token — and both have to complete for mutual trust.
// Either half may be the first one a device performs. Sharing a link
// issues first and then scans the reply; consuming a link scans first
// and then issues back. pairingStepsRemaining tracks what this device
// still owes and routes the wizard to the next unfinished step after
// each success.

import QRCode from 'qrcode';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { completePairing, initiatePairing } from '#src/pairing.ts';
import {
  issuedQr,
  issuedShareUrl,
  issuedToken,
  knownPeerCount,
  type PairingStep,
  pairingError,
  pairingMode,
  pairingStepsRemaining,
  persistSoloDeviceMode,
  scanInput,
} from '#src/pairing-state.ts';

interface PairingHandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function resetCeremony(): void {
  pairingStepsRemaining.value = new Set();
  issuedToken.value = null;
  issuedQr.value = null;
  issuedShareUrl.value = null;
  scanInput.value = '';
  pairingError.value = null;
}

function drainStep(step: PairingStep): ReadonlySet<PairingStep> {
  const next = new Set(pairingStepsRemaining.value);
  next.delete(step);
  pairingStepsRemaining.value = next;
  return next;
}

function shareUrlForToken(token: string): string {
  if (typeof window === 'undefined') {
    return `#pair=${encodeURIComponent(token)}`;
  }
  const url = new URL(window.location.href);
  url.hash = `pair=${encodeURIComponent(token)}`;
  return url.toString();
}

async function generateIssueArtefacts(): Promise<void> {
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const token = initiatePairing(keyring, peerId);
  const shareUrl = shareUrlForToken(token);
  issuedToken.value = token;
  issuedShareUrl.value = shareUrl;
  try {
    issuedQr.value = await QRCode.toString(shareUrl, { type: 'svg', margin: 1, width: 220 });
  } catch {
    issuedQr.value = null;
  }
}

async function applyScannedToken(token: string): Promise<boolean> {
  const keyring = await loadOrCreateKeyring();
  await completePairing(keyring, token);
  knownPeerCount.value = keyring.knownPeers.size;
  return true;
}

function advanceAfter(step: PairingStep): void {
  const remaining = drainStep(step);
  if (remaining.size === 0) {
    pairingMode.value = 'idle';
    issuedToken.value = null;
    issuedQr.value = null;
    issuedShareUrl.value = null;
    scanInput.value = '';
    // The MeshClient constructed at module load captured the keyring's
    // knownPeerIds as they stood then — empty on a first visit, stale on
    // a rejoin. Now that the ceremony has populated the keyring with a
    // new peer, the adapter has no path to discover it short of a fresh
    // module load. A full-page reload is the smallest correct fix: it
    // reconstructs the mesh stack with the new keyring and the
    // peers-present / peer-joined notifications do the rest.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
    return;
  }
  if (remaining.has('issue')) {
    pairingMode.value = 'wizard-issue';
    scanInput.value = '';
    pairingError.value = null;
    if (issuedToken.value === null) {
      void generateIssueArtefacts().catch((err) => {
        pairingError.value = err instanceof Error ? err.message : String(err);
      });
    }
    return;
  }
  pairingMode.value = 'wizard-scan';
  scanInput.value = '';
  pairingError.value = null;
}

// Consume a `#pair=<token>` hash on banner mount. Returns true if a
// token was present and submitted. Always clears the fragment from
// the URL so it doesn't leak further into history or bookmarks.
export async function consumePairingHash(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }
  const hash = window.location.hash;
  if (!hash.startsWith('#pair=')) {
    return false;
  }
  const token = decodeURIComponent(hash.slice('#pair='.length));
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!token) {
    return false;
  }
  pairingStepsRemaining.value = new Set<PairingStep>(['issue', 'scan']);
  pairingMode.value = 'wizard-scan';
  scanInput.value = token;
  pairingError.value = null;
  try {
    await applyScannedToken(token);
    advanceAfter('scan');
    return true;
  } catch (err) {
    pairingError.value = err instanceof Error ? err.message : String(err);
    return false;
  }
}

export const pairingActions: Record<string, (ctx: PairingHandlerContext) => void> = {
  'pairing.start-issue': () => {
    resetCeremony();
    pairingStepsRemaining.value = new Set<PairingStep>(['issue', 'scan']);
    pairingMode.value = 'wizard-issue';
    void generateIssueArtefacts().catch((err) => {
      pairingError.value = err instanceof Error ? err.message : String(err);
      pairingMode.value = 'idle';
      pairingStepsRemaining.value = new Set();
    });
  },

  'pairing.start-scan': () => {
    resetCeremony();
    pairingStepsRemaining.value = new Set<PairingStep>(['issue', 'scan']);
    pairingMode.value = 'wizard-scan';
  },

  'pairing.issue-done': () => {
    if (!pairingStepsRemaining.value.has('issue')) {
      return;
    }
    advanceAfter('issue');
  },

  'pairing.submit-scan': (ctx) => {
    const encoded = ctx.data.value;
    if (!encoded) {
      return;
    }
    (async () => {
      try {
        await applyScannedToken(encoded);
        advanceAfter('scan');
      } catch (err) {
        pairingError.value = err instanceof Error ? err.message : String(err);
      }
    })();
  },

  'pairing.cancel': () => {
    resetCeremony();
    pairingMode.value = 'idle';
  },

  'pairing.start-solo': () => {
    resetCeremony();
    pairingMode.value = 'idle';
    persistSoloDeviceMode(true);
  },
};
