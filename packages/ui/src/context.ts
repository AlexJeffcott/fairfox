// Dispatch context for @fairfox/ui primitives that need to fire actions
// programmatically without a natural DOM event to carry data-action.
//
// The global event delegator (see src/event-delegation.ts) handles
// click, submit, change, and input events natively. For events that
// don't have a corresponding DOM event — for example the Input
// primitive committing on blur, Enter, or Cmd+Enter — the primitive
// needs a way to ask the delegator to fire an action with a value
// that exists only in internal state.
//
// The solution is a Preact context that exposes the same dispatch
// function the delegator was installed with. The sub-app's root
// component wraps its tree in a DispatchContext.Provider with the
// same function it passed to installEventDelegation(), and any
// primitive that needs to fire actions programmatically reads the
// context and calls the function directly. The payload is still an
// ActionDispatch, so action handlers receive the same shape whether
// the dispatch came from a real DOM event or from a primitive's
// internal state machine.

import { createContext } from 'preact';
import type { ActionDispatch } from './event-delegation.ts';

export type DispatchFn = (dispatch: ActionDispatch) => void;

export const DispatchContext = createContext<DispatchFn | null>(null);
