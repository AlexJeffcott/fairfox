/** @jsxImportSource preact */
// Boot sequence for the unified fairfox SPA. Phase 1 keeps the
// landing behaviour identical to the pre-unification hub — same
// MeshGate, same action registry, same self-peer init — but the
// per-sub-app boot files will collapse into this one in later
// phases as each sub-app's `<App>` component gets plugged in as a
// route.

import '@fairfox/polly/ui/styles.css';
import '@fairfox/polly/ui/theme.css';

import { installEventDelegation } from '@fairfox/polly/actions';
import { touchSelfDeviceEntry } from '@fairfox/shared/devices-state';
import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { dispatch } from '#src/client/registry.ts';
import { setSelfPeerId } from '#src/client/self-peer.ts';

function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

installEventDelegation(dispatch);

// Populate the self-peer id as soon as the keyring resolves so
// PeersView can flag this device's own row. Independent of
// MeshGate's own load path — both end up reading the same keyring
// blob, and the keyring load is idempotent.
void (async () => {
  try {
    const keyring = await loadOrCreateKeyring();
    const peerId = derivePeerId(keyring.identity.publicKey);
    setSelfPeerId(peerId);
    if (keyring.knownPeers.size > 0) {
      touchSelfDeviceEntry(peerId, { agent: 'browser' });
    }
  } catch {
    // Best-effort. If the keyring load fails the gate will surface
    // the error through its own path.
  }
})();

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
