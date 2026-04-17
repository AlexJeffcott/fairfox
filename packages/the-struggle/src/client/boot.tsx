/** @jsxImportSource preact */
// Boot sequence for The Struggle sub-app client.

import '@fairfox/polly/ui/styles.css';
import '@fairfox/polly/ui/theme.css';

import { type ActionDispatch, installEventDelegation } from '@fairfox/polly/actions';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { registry } from '#src/client/actions.ts';
import { progressState, storyState } from '#src/client/state.ts';

async function boot(): Promise<void> {
  await Promise.all([storyState.loaded, progressState.loaded]);

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
