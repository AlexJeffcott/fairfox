/** @jsxImportSource preact */
// Boot sequence for a fairfox sub-app client.
//
// 1. Load or create the device's MeshKeyring from IndexedDB.
// 2. Connect to the signaling server and establish the mesh transport.
// 3. Wait for the $meshState documents to hydrate from the Repo.
// 4. Mount the Preact app with the DispatchContext wired to the action
//    registry and the event delegation installed at the document root.
//
// Copy this file when starting a new sub-app. The only things to change
// are the import paths for state.ts, actions.ts, and App.tsx.

import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { createMeshConnection } from '@fairfox/shared/mesh';
import { type ActionDispatch, DispatchContext, installEventDelegation } from '@fairfox/ui';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { registry } from '#src/client/actions.ts';
import { appState } from '#src/client/state.ts';

async function boot(): Promise<void> {
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const signalingUrl = `${proto}//${window.location.host}/polly/signaling`;

  // The mesh connection must stay alive for the duration of the app.
  // Storing on globalThis prevents GC and makes it accessible for
  // disconnect on page unload if needed.
  (globalThis as Record<string, unknown>).__fairfoxMesh = createMeshConnection({
    keyring,
    peerId,
    signalingUrl,
  });

  await appState.loaded;

  const dispatch = (d: ActionDispatch): void => {
    const handler = registry[d.action];
    if (handler) {
      handler({ data: d.data, event: d.event, element: d.element });
    }
  };

  installEventDelegation(dispatch);

  const root = document.getElementById('app');
  if (root) {
    render(
      <DispatchContext.Provider value={dispatch}>
        <App />
      </DispatchContext.Provider>,
      root
    );
  }
}

boot();
