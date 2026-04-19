/** @jsxImportSource preact */
// Boot sequence for the Library sub-app client.

import '@fairfox/polly/ui/styles.css';
import '@fairfox/polly/ui/theme.css';

import { type ActionDispatch, installEventDelegation } from '@fairfox/polly/actions';
import { RequirePaired } from '@fairfox/shared/require-paired';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { registry } from '#src/client/actions.ts';
import { libraryState } from '#src/client/state.ts';

async function boot(): Promise<void> {
  await libraryState.loaded;

  installEventDelegation((d: ActionDispatch) => {
    const handler = registry[d.action];
    if (handler) {
      handler({ data: d.data, event: d.event, element: d.element });
    }
  });

  const root = document.getElementById('app');
  if (root) {
    render(
      <RequirePaired>
        <App />
      </RequirePaired>,
      root
    );
  }
}

boot();
