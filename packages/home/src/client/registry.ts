// Unified action registry + dispatcher. Every mesh sub-app's
// handlers merge into one map so the single
// `installEventDelegation` call at boot can dispatch anywhere in
// the app without each sub-app running its own delegation.
//
// The dispatcher also applies per-sub-app permission gates (e.g.
// `todo.write` on todo-v2's mutations, `agenda.write` on agenda's).
// Each sub-app exports both its `registry` and a set of action
// names that require a specific capability; the dispatcher
// consults `canDo()` before running any gated handler.

import { AGENDA_WRITE_ACTIONS, registry as agendaRegistry } from '@fairfox/agenda/actions';
import { DOCS_WRITE_ACTIONS, registry as docsRegistry } from '@fairfox/docs/actions';
import { registry as familyPhoneRegistry } from '@fairfox/family-phone-admin/actions';
import { registry as libraryRegistry } from '@fairfox/library/actions';
import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { canDo } from '@fairfox/shared/policy';
import { pwaInstallActions } from '@fairfox/shared/pwa-install';
import { registry as speakwellRegistry } from '@fairfox/speakwell/actions';
import { registry as theStruggleRegistry } from '@fairfox/the-struggle/actions';
import { TODO_WRITE_ACTIONS, registry as todoRegistry } from '@fairfox/todo-v2/actions';
import { homeActions } from '#src/client/home-actions.ts';
import { routerActions } from '#src/client/router.ts';

type HandlerContext = {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
};

type ActionDispatch = {
  action: string;
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
};

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,
  ...pwaInstallActions,
  ...homeActions,
  ...routerActions,
  ...todoRegistry,
  ...agendaRegistry,
  ...docsRegistry,
  ...libraryRegistry,
  ...familyPhoneRegistry,
  ...speakwellRegistry,
  ...theStruggleRegistry,
};

/** Event-delegation callback. Gates each dispatch against the
 * relevant capability before calling the handler so the unified
 * shell honours per-sub-app policy without each sub-app needing
 * its own `installEventDelegation`. */
export function dispatch(d: ActionDispatch): void {
  const handler = registry[d.action];
  if (!handler) {
    return;
  }
  if (TODO_WRITE_ACTIONS.has(d.action) && !canDo('todo.write')) {
    console.warn(`[policy] blocked ${d.action}: user lacks todo.write`);
    return;
  }
  if (AGENDA_WRITE_ACTIONS.has(d.action) && !canDo('agenda.write')) {
    console.warn(`[policy] blocked ${d.action}: user lacks agenda.write`);
    return;
  }
  // Docs writes are ungated for now — policy.ts doesn't yet carry a
  // `docs.write` permission. The set is still exported so the gate
  // can flip on without touching the dispatcher once the policy is
  // extended. Reference the constant to silence unused-import
  // checkers.
  void DOCS_WRITE_ACTIONS;
  handler({ data: d.data, event: d.event, element: d.element });
}
