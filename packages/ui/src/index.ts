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

export type { BadgeProps, BadgeVariant } from './components/Badge/index.ts';
export { Badge } from './components/Badge/index.ts';
export type {
  ButtonColor,
  ButtonProps,
  ButtonSize,
  ButtonTier,
} from './components/Button/index.ts';
export { Button } from './components/Button/index.ts';
export type { CheckboxProps } from './components/Checkbox/index.ts';
export { Checkbox } from './components/Checkbox/index.ts';
export type { CollapsibleProps } from './components/Collapsible/index.ts';
export { Collapsible } from './components/Collapsible/index.ts';
export type { DropdownProps } from './components/Dropdown/index.ts';
export { Dropdown } from './components/Dropdown/index.ts';
export type { InputProps, InputSaveOn, InputVariant } from './components/Input/index.ts';
export { Input } from './components/Input/index.ts';
export type { LayoutAlign, LayoutJustify, LayoutProps } from './components/Layout/index.ts';
export { Layout } from './components/Layout/index.ts';
export type { ModalProps, ModalSize } from './components/Modal/index.ts';
export { Modal } from './components/Modal/index.ts';
export type { SelectOption, SelectProps } from './components/Select/index.ts';
export { Select } from './components/Select/index.ts';
export type { SkeletonProps, SkeletonVariant } from './components/Skeleton/index.ts';
export { Skeleton } from './components/Skeleton/index.ts';
export type { Tab, TabsProps } from './components/Tabs/index.ts';
export { Tabs } from './components/Tabs/index.ts';
export type { ToastProps, ToastVariant } from './components/Toast/index.ts';
export { Toast } from './components/Toast/index.ts';
export type { ToggleProps } from './components/Toggle/index.ts';
export { Toggle } from './components/Toggle/index.ts';
export type { DispatchFn } from './context.ts';
export { DispatchContext } from './context.ts';
export type { ActionDispatch } from './event-delegation.ts';
export {
  ACTION_EVENT_TYPES,
  closeTopOverlay,
  INTERACTIVE_TAGS,
  installEventDelegation,
  parseActionData,
  resolveAction,
} from './event-delegation.ts';
export type { HTMLPassthroughProps } from './utils/html-attrs.ts';
export { collectHTMLAttrs } from './utils/html-attrs.ts';
