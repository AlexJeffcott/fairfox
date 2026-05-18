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
import { agenda } from '@fairfox/agenda/state';
import { installChatHistoryEffects } from '@fairfox/chat/client';
import { chatState } from '@fairfox/chat/state';
import { installDocsEffects } from '@fairfox/docs/client';
import { docsState } from '@fairfox/docs/state';
import { directoryState } from '@fairfox/family-phone-admin/state';
import { installLibraryEffects } from '@fairfox/library/client';
import { libraryState } from '@fairfox/library/state';
import { installEventDelegation } from '@fairfox/polly/actions';
import { installBuildFreshnessPoll } from '@fairfox/shared/build-freshness';
import { installConnectionRecovery } from '@fairfox/shared/connection-recovery';
import { devicesState, touchSelfDeviceEntry } from '@fairfox/shared/devices-state';
import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { installMeshGateEffects } from '@fairfox/shared/mesh-gate';
import { meshMetaState } from '@fairfox/shared/mesh-meta-state';
import { installPairingHashListener } from '@fairfox/shared/pairing-actions';
import { installPwaInstallListeners } from '@fairfox/shared/pwa-install';
import { installQrCameraLifecycle, installQrPasteListener } from '@fairfox/shared/qr-scan';
import { installRequirePairedEffects } from '@fairfox/shared/require-paired';
import { installStorageHealthPoll } from '@fairfox/shared/storage-health';
import { usersState } from '@fairfox/shared/users-state';
import { sessionsState } from '@fairfox/speakwell/state';
import { installTheStruggleEffects } from '@fairfox/the-struggle/client';
import { progressState, storyState } from '@fairfox/the-struggle/state';
import { installTodoEffects } from '@fairfox/todo-v2/client';
import { capturesState, projectsState, tasksState } from '@fairfox/todo-v2/state';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { installHomeEffects } from '#src/client/Home.tsx';
import { dispatch } from '#src/client/registry.ts';
import { setSelfPeerId } from '#src/client/self-peer.ts';

const mark = (label: string): void => {
  const fn = (globalThis as unknown as { __mark?: (s: string) => void }).__mark;
  if (typeof fn === 'function') {
    fn(label);
  }
};

mark('B: bundle imports resolved');

function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Pre-warm every `$meshState` document handle before the first peer
// connection forms. polly#106's diagnostic ladder pinpointed the
// failing-shape: when the daemon's sync message for `mesh:users`
// arrives at the browser, Automerge's NetworkSubsystem only
// advertises docs that are already in the local repo's handle table.
// `$meshState(key, initial)` lazily seeds + registers the handle via
// `repo.import()` on first access; before this commit, sub-app state
// modules only loaded on route navigation, so a freshly-paired tab
// sitting on the hub view had no handles for `todo:tasks` /
// `library:main` / etc., and the daemon's sync messages for those
// docs had nothing on this side to negotiate against — `firstSend`
// stayed `(none)` in the Help-tab diagnostic indefinitely. Touching
// `.value` on each singleton at boot triggers the lazy `$meshState`
// construction so the handle is registered before WebRTC opens.
//
// The reads are deliberately discarded — the values they return are
// the wrappers' initial empty payload (until the bridge fires on the
// next microtask), which is irrelevant. The side effect of `.value`
// reaching into the singleton accessor is the point.
mark('C0: pre-warm start');
void usersState.value;
mark('C1: usersState');
void devicesState.value;
mark('C2: devicesState');
void meshMetaState.value;
mark('C3: meshMetaState');
void projectsState.value;
mark('C4: projectsState');
void tasksState.value;
mark('C5: tasksState');
void capturesState.value;
mark('C6: capturesState');
void agenda.value;
mark('C7: agenda');
void libraryState.value;
mark('C8: libraryState');
void docsState.value;
mark('C9: docsState');
void chatState.value;
mark('C10: chatState');
void storyState.value;
mark('C11: storyState');
void progressState.value;
mark('C12: progressState');
void sessionsState.value;
mark('C13: sessionsState');
void directoryState.value;
mark('C14: directoryState (pre-warm done)');

installEventDelegation(dispatch);
mark('D1: installEventDelegation');
installBuildFreshnessPoll();
mark('D2: installBuildFreshnessPoll');
installStorageHealthPoll();
mark('D3: installStorageHealthPoll');
installPairingHashListener();
mark('D4: installPairingHashListener');
installQrCameraLifecycle();
mark('D5: installQrCameraLifecycle');
installQrPasteListener();
mark('D6: installQrPasteListener');
installMeshGateEffects();
mark('D7: installMeshGateEffects');
installConnectionRecovery();
mark('D8: installConnectionRecovery');
installRequirePairedEffects();
mark('D9: installRequirePairedEffects');
installPwaInstallListeners();
mark('D10: installPwaInstallListeners');
installHomeEffects();
mark('D11: installHomeEffects');
installTodoEffects();
mark('D12: installTodoEffects');
installAgendaEffects();
mark('D13: installAgendaEffects');
installLibraryEffects();
mark('D14: installLibraryEffects');
installDocsEffects();
mark('D15: installDocsEffects');
installChatHistoryEffects();
mark('D16: installChatHistoryEffects');
installTheStruggleEffects();
mark('D17: installTheStruggleEffects (effects done)');

// Populate the self-peer id as soon as the keyring resolves so
// PeersView can flag this device's own row. Independent of
// MeshGate's own load path — both end up reading the same keyring
// blob, and the keyring load is idempotent.
mark('E0: keyring load scheduled');
void (async () => {
  try {
    const keyring = await loadOrCreateKeyring();
    mark('E1: keyring resolved');
    const peerId = derivePeerId(keyring.identity.publicKey);
    setSelfPeerId(peerId);
    if (keyring.knownPeers.size > 0) {
      touchSelfDeviceEntry(peerId, { agent: 'browser' });
    }
    mark('E2: keyring effects applied');
  } catch (err) {
    mark(`E!: keyring failed: ${err instanceof Error ? err.message : String(err)}`);
    // Best-effort. If the keyring load fails the gate will surface
    // the error through its own path.
  }
})();

mark('F0: about to render <App>');
const root = document.getElementById('app');
if (root) {
  render(<App />, root);
  mark('F1: render returned');
} else {
  mark('F!: no #app element');
}
