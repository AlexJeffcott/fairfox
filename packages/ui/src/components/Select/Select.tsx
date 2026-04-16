/** @jsxImportSource preact */
// Select primitive for @fairfox/ui.
//
// Composes Dropdown for the menu and Checkbox for multi-select items.
// Trigger button shows selected label(s) or placeholder. Signal<Set<T>>
// is the canonical state shape. Single-select closes on pick;
// multi-select keeps the menu open and offers Select All / Clear
// actions via buttons with data-action attributes.

import type { Signal } from '@preact/signals';
import { useComputed, useSignal } from '@preact/signals';
import { clsx } from 'clsx';
import { Dropdown } from '#src/components/Dropdown/Dropdown.tsx';
import { Layout } from '#src/components/Layout/Layout.tsx';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Select.module.css';

export type SelectOption<T = string> = { value: T; label: string };

export type SelectProps<T = string> = HTMLPassthroughProps & {
  options: SelectOption<T>[];
  selected: Signal<Set<T>>;
  label?: string;
  placeholder?: string;
  multiSelect?: boolean;
  disabled?: boolean;
  className?: string;
};

function formatSelected<T>(options: SelectOption<T>[], selected: Set<T>): string {
  if (selected.size === 0) {
    return '';
  }
  const labels: string[] = [];
  for (const opt of options) {
    if (selected.has(opt.value)) {
      labels.push(opt.label);
    }
  }
  return labels.join(', ');
}

export function Select<T = string>(props: SelectProps<T>) {
  const {
    options,
    selected,
    label,
    placeholder = 'Select\u2026',
    multiSelect = false,
    disabled = false,
    className,
  } = props;

  const htmlAttrs = collectHTMLAttrs(props);
  const isOpen = useSignal(false);

  const displayText = useComputed(() => {
    const text = formatSelected(options, selected.value);
    return text.length > 0 ? text : placeholder;
  });

  const isEmpty = useComputed(() => selected.value.size === 0);

  const handleOptionClick = (value: T): void => {
    if (multiSelect) {
      const next = new Set(selected.value);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      selected.value = next;
    } else {
      selected.value = new Set([value]);
      isOpen.value = false;
    }
  };

  const handleSelectAll = (): void => {
    selected.value = new Set(options.map((o) => o.value));
  };

  const handleClear = (): void => {
    selected.value = new Set();
  };

  const triggerButton = (
    <button
      type="button"
      className={clsx(classes.trigger, isEmpty.value && classes.placeholder)}
      disabled={disabled}
    >
      {displayText.value}
    </button>
  );

  return (
    <div {...htmlAttrs} className={clsx(classes.select, className)}>
      {label !== undefined && <span className={classes.label}>{label}</span>}
      <Dropdown isOpen={isOpen} trigger={triggerButton} multiSelect={multiSelect}>
        {multiSelect && (
          <div className={classes.actions}>
            <Layout columns="1fr 1fr" gap="var(--space-xs)">
              <button type="button" className={classes.actionBtn} onClick={handleSelectAll}>
                Select All
              </button>
              <button type="button" className={classes.actionBtn} onClick={handleClear}>
                Clear
              </button>
            </Layout>
          </div>
        )}
        {options.map((opt) => {
          const isSelected = selected.value.has(opt.value);
          return (
            <button
              key={String(opt.value)}
              type="button"
              className={clsx(classes.option, isSelected && classes.optionSelected)}
              onClick={() => handleOptionClick(opt.value)}
            >
              {multiSelect && (
                <input
                  type="checkbox"
                  className={classes.optionCheck}
                  checked={isSelected}
                  tabIndex={-1}
                  readOnly={true}
                />
              )}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </Dropdown>
    </div>
  );
}
