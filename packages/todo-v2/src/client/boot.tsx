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
import { capturesState, projectsState, tasksState } from '#src/client/state.ts';

/** Actions that mutate `todo:*` CRDT state and therefore require
 * `todo.write`. View-state toggles (`*.open`, `*.close`, `*.new`,
 * `todo.tab`) only flip local signals and stay unguarded. */
const TODO_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'project.create',
  'project.update-status',
  'project.delete',
  'project.delete-and-close',
  'project.update',
  'task.create',
  'task.toggle-done',
  'task.set-priority',
  'task.update-notes',
  'task.delete',
  'task.delete-and-close',
  'task.update',
  'capture.add',
  'capture.delete',
  'capture.update',
  'capture.promote',
  'migrate.from-legacy',
]);

async function boot(): Promise<void> {
  await Promise.all([projectsState.loaded, tasksState.loaded, capturesState.loaded]);

  installEventDelegation((d: ActionDispatch) => {
    const handler = registry[d.action];
    if (!handler) {
      return;
    }
    if (TODO_WRITE_ACTIONS.has(d.action) && !canDo('todo.write')) {
      console.warn(`[policy] blocked ${d.action}: user lacks todo.write`);
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
