/** @jsxImportSource preact */
// Toggle (switch) primitive for @fairfox/ui.
//
// A hidden <input role="switch"> paired with styled track and thumb
// spans inside a <label>. The track is 36x20px with a rounded pill
// shape; the thumb is a 16x16 circle that slides right when checked.
// Colors and transitions come from tokens.

import { clsx } from 'clsx';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Toggle.module.css';

export type ToggleProps = HTMLPassthroughProps & {
  checked?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export function Toggle(props: ToggleProps) {
  const { checked = false, disabled = false, label, className } = props;

  const htmlAttrs = collectHTMLAttrs(props);

  return (
    <label {...htmlAttrs} className={clsx(classes.toggle, disabled && classes.disabled, className)}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className={classes.input}
        checked={checked}
        disabled={disabled}
      />
      <span className={clsx(classes.track, checked && classes.trackChecked)}>
        <span className={clsx(classes.thumb, checked && classes.thumbChecked)} />
      </span>
      {label !== undefined && <span className={classes.label}>{label}</span>}
    </label>
  );
}
