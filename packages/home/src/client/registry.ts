// Unified action registry + dispatcher. Every mesh sub-app's
// handlers merge into one map so the single
// `installEventDelegation` call at boot can dispatch anywhere in
// the app without each sub-app running its own delegation.
//
// The dispatcher also applies per-sub-app permission gates (e.g.
// `todo.write` on todo-v2's mutations). Each sub-app exports both
// its `registry` and a set of action names that require a
// specific capability; the dispatcher consults `canDo()` before
// running any gated handler.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { canDo } from '@fairfox/shared/policy';
import { pwaInstallActions } from '@fairfox/shared/pwa-install';
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
  handler({ data: d.data, event: d.event, element: d.element });
}
