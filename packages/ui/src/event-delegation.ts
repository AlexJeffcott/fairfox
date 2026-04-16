// Event delegation core for @fairfox/ui.
//
// Pure functions implementing the mechanics that back the global action
// dispatch. A fairfox sub-app mounts this once at the document root, and
// every component simply declares its intent via data-action attributes;
// the delegator walks up from the event target, resolves the matching
// data-action element, parses any data-action-* payload into a record,
// and hands the result to a per-sub-app dispatch handler. No component in
// @fairfox/ui accepts onClick, onChange, onSubmit, or onBlur props, so this
// delegator is the entire event-to-behaviour surface of the UI.
//
// Adapted from Lingua's packages/web/src/providers/event-delegation.ts.
// ADR 0002 has the rationale for why the delegation pattern is mandatory.

/** Elements that natively fire click on Enter/Space and already handle keyboard activation. */
export const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  'BUTTON',
  'A',
  'INPUT',
  'SELECT',
  'TEXTAREA',
]);

/** Event types that may trigger a data-action dispatch. */
export const ACTION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'click',
  'submit',
  'change',
  'input',
]);

/** Parsed action dispatch — the shape a handler receives after resolution. */
export type ActionDispatch = {
  readonly action: string;
  readonly element: HTMLElement;
  readonly event: Event;
  readonly data: Record<string, string>;
};

/**
 * Parse data-action-* attributes from an element into camelCase key/value pairs.
 *
 * An element written as `<button data-action="task.save" data-action-id="42"
 * data-action-body="hello">` yields `{ id: "42", body: "hello" }`.
 */
export function parseActionData(element: HTMLElement): Record<string, string> {
  const data: Record<string, string> = {};
  for (const attr of element.attributes) {
    if (attr.name.startsWith('data-action-')) {
      const key = attr.name
        .replace('data-action-', '')
        .replace(/-([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
      data[key] = attr.value;
    }
  }
  return data;
}

/**
 * Close the topmost overlay by dispatching an overlay:close custom event.
 *
 * Overlays are elements with a data-overlay-id attribute — Modal and its
 * kin opt in by rendering with that attribute. The delegator fires this
 * on Escape and on mousedown outside any overlay.
 */
export function closeTopOverlay(): void {
  const overlays = document.querySelectorAll('[data-overlay-id]');
  if (overlays.length === 0) {
    return;
  }
  const topOverlay = overlays[overlays.length - 1];
  if (!topOverlay) {
    return;
  }
  topOverlay.dispatchEvent(
    new CustomEvent('overlay:close', {
      bubbles: true,
      detail: { id: topOverlay.getAttribute('data-overlay-id') },
    })
  );
}

/**
 * Resolve a DOM event to an ActionDispatch, or null if nothing matches.
 *
 * Click events on forms are intentionally skipped — a `<form data-action>`
 * should only fire on submit, not when a child (like a dropdown option) is
 * clicked and the click bubbles through the form. The form's submit handler
 * is the one that triggers the form's action.
 */
export function resolveAction(event: Event): ActionDispatch | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const actionElement = target.closest('[data-action]');
  if (!(actionElement instanceof HTMLElement)) {
    return null;
  }
  if (event.type === 'click' && actionElement.tagName === 'FORM') {
    return null;
  }
  const action = actionElement.getAttribute('data-action');
  if (!action) {
    return null;
  }
  return {
    action,
    element: actionElement,
    event,
    data: parseActionData(actionElement),
  };
}

/**
 * Install all document-level event listeners for the delegation system and
 * return a cleanup function that removes them.
 *
 * - Click, submit, change, and input events are captured and routed through
 *   resolveAction; anything with a matching data-action fires onDispatch.
 * - Escape closes the topmost overlay.
 * - Enter or Space on a focused non-interactive element with a data-action
 *   resolves and fires the action, mirroring the keyboard behaviour the
 *   browser already gives to buttons and links for free.
 * - Mousedown outside any overlay closes the topmost overlay.
 */
export function installEventDelegation(onDispatch: (dispatch: ActionDispatch) => void): () => void {
  const handleActionEvent = (event: Event): void => {
    const dispatch = resolveAction(event);
    if (dispatch) {
      onDispatch(dispatch);
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      closeTopOverlay();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (INTERACTIVE_TAGS.has(target.tagName)) {
        return;
      }
      const dispatch = resolveAction(event);
      if (dispatch) {
        event.preventDefault();
        onDispatch(dispatch);
      }
    }
  };

  const handleMouseDown = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const clickedOverlay = event.target.closest('[data-overlay-id]');
    if (!clickedOverlay) {
      closeTopOverlay();
    }
  };

  for (const eventType of ACTION_EVENT_TYPES) {
    document.addEventListener(eventType, handleActionEvent);
  }
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('mousedown', handleMouseDown);

  return () => {
    for (const eventType of ACTION_EVENT_TYPES) {
      document.removeEventListener(eventType, handleActionEvent);
    }
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('mousedown', handleMouseDown);
  };
}
