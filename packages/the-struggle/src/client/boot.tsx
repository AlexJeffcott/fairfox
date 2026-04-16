/** @jsxImportSource preact */
// Boot sequence for The Struggle sub-app client.

import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { createMeshConnection } from '@fairfox/shared/mesh';
import { type ActionDispatch, DispatchContext, installEventDelegation } from '@fairfox/ui';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { registry } from '#src/client/actions.ts';
import { progressState, storyState } from '#src/client/state.ts';

async function boot(): Promise<void> {
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const signalingUrl = `${proto}//${window.location.host}/polly/signaling`;

  createMeshConnection({
    keyring,
    peerId,
    signalingUrl,
  });

  await Promise.all([storyState.loaded, progressState.loaded]);

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
