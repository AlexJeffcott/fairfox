/** @jsxImportSource preact */
// Boot sequence for a fairfox sub-app client.
//
// The mesh transport is set up by @fairfox/shared/ensure-mesh, which every
// state.ts imports so that polly's Repo is configured before any $meshState
// primitive is declared. Boot therefore only has to wait for the documents
// to hydrate and mount the Preact tree.

import '@fairfox/polly/ui/styles.css';
import '@fairfox/polly/ui/theme.css';

import { type ActionDispatch, installEventDelegation } from '@fairfox/polly/actions';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { registry } from '#src/client/actions.ts';
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

async function boot(): Promise<void> {
  await Promise.all([projectsState.loaded, tasksState.loaded, capturesState.loaded]);

  installEventDelegation((d: ActionDispatch) => {
    const handler = registry[d.action];
    if (handler) {
      handler({ data: d.data, event: d.event, element: d.element });
    }
  });

  const root = document.getElementById('app');
  if (root) {
    render(<App />, root);
  }
}

boot();
