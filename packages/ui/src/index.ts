// @fairfox/ui — shared UI primitives and event delegation for fairfox sub-apps.
//
// Every interactive primitive in this package refuses to accept onClick,
// onChange, onSubmit, or onBlur props. User actions are declared via
// data-action attributes and routed through the global event delegator.
// See docs/adr/0002-state-management-and-event-delegation-via-polly.md
// and docs/adr/0005-shared-ui-primitives-in-fairfox-ui.md for the rationale.
//
// Exports grow as each phase of T291 lands. Phase A: utils. Phase B: event
// delegation. Phase C: Button. Phase D: Input.

export type { HTMLPassthroughProps } from './utils/html-attrs.ts';
export { collectHTMLAttrs } from './utils/html-attrs.ts';
