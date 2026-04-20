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
import { canDo } from '@fairfox/shared/policy';
import { RequirePaired } from '@fairfox/shared/require-paired';
import { render } from 'preact';
import { App } from '#src/client/App.tsx';
import { registry } from '#src/client/actions.ts';
import { agenda } from '#src/client/state.ts';

/** Actions that mutate `agenda:*` state and therefore require
 * `agenda.write`. `agenda.tab` only flips a local view signal. */
const AGENDA_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'item.create',
  'item.delete',
  'item.toggle-active',
  'chore.done',
  'chore.snooze',
]);

async function boot(): Promise<void> {
  await agenda.loaded;

  installEventDelegation((d: ActionDispatch) => {
    const handler = registry[d.action];
    if (!handler) {
      return;
    }
    if (AGENDA_WRITE_ACTIONS.has(d.action) && !canDo('agenda.write')) {
      console.warn(`[policy] blocked ${d.action}: user lacks agenda.write`);
      return;
    }
    handler({ data: d.data, event: d.event, element: d.element });
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
