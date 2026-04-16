/** @jsxImportSource preact */
// Checkbox primitive for @fairfox/ui.
//
// Wraps a native <input type="checkbox"> in a <label> for accessible
// click targets. When checked is a Preact Signal, the checkbox mutates
// it directly on change; when it is a plain boolean the checkbox is
// controlled by the consumer. CSS uses accent-color from tokens.

import type { Signal } from '@preact/signals';
import { clsx } from 'clsx';
import type { JSX } from 'preact';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Checkbox.module.css';

export type CheckboxProps = HTMLPassthroughProps & {
  checked?: boolean | Signal<boolean>;
  defaultChecked?: boolean;
  name?: string;
  disabled?: boolean;
  label?: string;
  className?: string;
};

function isSignal(value: unknown): value is Signal<boolean> {
  return typeof value === 'object' && value !== null && 'value' in value && 'peek' in value;
}

export function Checkbox(props: CheckboxProps) {
  const { checked, defaultChecked, name, disabled = false, label, className } = props;

  const htmlAttrs = collectHTMLAttrs(props);

  const handleChange = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    if (isSignal(checked)) {
      checked.value = e.currentTarget.checked;
    }
  };

  const checkedProp = isSignal(checked) ? checked.value : checked;

  return (
    <label
      {...htmlAttrs}
      className={clsx(classes.checkbox, disabled && classes.disabled, className)}
    >
      <input
        type="checkbox"
        className={classes.input}
        checked={checkedProp}
        defaultChecked={defaultChecked}
        name={name}
        disabled={disabled}
        onChange={handleChange}
      />
      {label !== undefined && <span className={classes.label}>{label}</span>}
    </label>
  );
}
