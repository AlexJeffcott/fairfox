// Per-device signal holding "what is the user looking at right now?"
// so the chat widget can auto-attach relevant context to messages
// without the user having to type ids. Each sub-app writes to this
// on route / view / selection changes; the widget reads it.
//
// Concretely: todo-v2 publishes `{ kind: 'task', id: 'T42' }` when a
// task is opened and `{ kind: 'tasks-list', filterSummary: ... }`
// when the list is showing. The signal is a plain Preact signal —
// view state, not mesh state, so it doesn't replicate.

import { signal } from '@preact/signals';

/** Categories the relay knows how to resolve. Extend when a new
 * sub-app adds a context kind; the relay's `resolveContext` must
 * grow a matching branch. */
export type PageContextKind =
  | 'project'
  | 'task'
  | 'tasks-list'
  | 'agenda'
  | 'agenda-today'
  | 'doc'
  | 'docs-list'
  | 'library'
  | 'struggle'
  | 'hub';

export interface PageContext {
  [key: string]: unknown;
  kind: PageContextKind;
  /** Entity id when the context is a single record (task T42, doc
   * slug, …). Empty for "list" / "view" kinds that represent a
   * subset rather than a record. */
  id?: string;
  /** Human-readable label shown in the widget chip. Keep short. */
  label: string;
  /** Arbitrary extra details the relay uses to resolve the context.
   * Optional and kind-specific (e.g. a tasks-list carries
   * `filterSummary` + `taskIds` so the relay can serialise the
   * right subset into the prompt). */
  details?: Record<string, unknown>;
}

export const currentPageContext = signal<PageContext | null>(null);

/** Set the current page context. Sub-apps call this from a
 * top-level effect keyed on their view-state signals. Pass `null`
 * to clear (e.g. on unmount), though the hub clears-and-sets to
 * `{ kind: 'hub', label: 'Hub' }` instead so the widget is never
 * context-less. */
export function setPageContext(ctx: PageContext | null): void {
  currentPageContext.value = ctx;
}
