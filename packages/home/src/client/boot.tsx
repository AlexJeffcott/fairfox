/** @jsxImportSource preact */
// Boot sequence for the unified fairfox SPA. Phase 1 keeps the
// landing behaviour identical to the pre-unification hub — same
// MeshGate, same action registry, same self-peer init — but the
// per-sub-app boot files will collapse into this one in later
// phases as each sub-app's `<App>` component gets plugged in as a
// route.

import '@fairfox/polly/ui/styles.css';
import '@fairfox/polly/ui/theme.css';

// Swallow automerge-wasm OOM rejections so a single malformed sync
// message doesn't crash the whole app. The `error inflating
// document chunk ops` error comes from a sync message that the
// WASM runtime can't expand — which can happen after a run of
// degenerate writes produced huge ops (the bumpSelfLastSeen loop
// that v0.29.x of polly + an earlier MeshGate bug triggered).
// Surfacing it as an unhandled rejection crashed the page before
// the user could use the "Reset local mesh state" escape hatch.
// Here we log it and let the app keep rendering; the sync layer
// drops the bad message and retries.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const r = event.reason;
    const msg = typeof r === 'object' && r !== null ? String(r.message ?? r) : String(r);
    if (
      msg.includes('inflating document chunk') ||
      msg.includes('out of memory') ||
      (r instanceof RangeError && msg.toLowerCase().includes('memory'))
    ) {
      console.warn('[fairfox] suppressed automerge OOM, dropping sync message:', msg);
      event.preventDefault();
    }
  });
}

import { installAgendaEffects } from '@fairfox/agenda/client';
import { installChatHistoryEffects } from '@fairfox/chat/client';
import { installDocsEffects } from '@fairfox/docs/client';
import { installLibraryEffects } from '@fairfox/library/client';
import { installEventDelegation } from '@fairfox/polly/actions';
import { installBuildFreshnessPoll } from '@fairfox/shared/build-freshness';
import { touchSelfDeviceEntry } from '@fairfox/shared/devices-state';
import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { installMeshGateEffects } from '@fairfox/shared/mesh-gate';
import { installPairingHashListener } from '@fairfox/shared/pairing-actions';
import { installPwaInstallListeners } from '@fairfox/shared/pwa-install';
import { installQrCameraLifecycle, installQrPasteListener } from '@fairfox/shared/qr-scan';
import { installRequirePairedEffects } from '@fairfox/shared/require-paired';
import { installTheStruggleEffects } from '@fairfox/the-struggle/client';
import { installTodoEffects } from '@fairfox/todo-v2/client';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { installHomeEffects } from '#src/client/Home.tsx';
import { dispatch } from '#src/client/registry.ts';
import { setSelfPeerId } from '#src/client/self-peer.ts';

function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

installEventDelegation(dispatch);
installBuildFreshnessPoll();
installPairingHashListener();
installQrCameraLifecycle();
installQrPasteListener();
installMeshGateEffects();
installRequirePairedEffects();
installPwaInstallListeners();
installHomeEffects();
installTodoEffects();
installAgendaEffects();
installLibraryEffects();
installDocsEffects();
installChatHistoryEffects();
installTheStruggleEffects();

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
