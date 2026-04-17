/** @jsxImportSource preact */
// Boot sequence for the Library sub-app client.

import { type ActionDispatch, DispatchContext, installEventDelegation } from '@fairfox/ui';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { registry } from '#src/client/actions.ts';
import { libraryState } from '#src/client/state.ts';

async function boot(): Promise<void> {
  await libraryState.loaded;

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
