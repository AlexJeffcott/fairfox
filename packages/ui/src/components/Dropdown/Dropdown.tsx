/** @jsxImportSource preact */
// Dropdown primitive for @fairfox/ui.
//
// Uses the native Popover API: the menu div gets popover="auto" and
// a trigger button gets popovertarget set imperatively. The isOpen
// signal stays in sync with the popover's toggle event. Integrates
// with the overlay:close system via data-overlay-id.

import type { Signal } from '@preact/signals';
import { useSignalEffect } from '@preact/signals';
import { clsx } from 'clsx';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Layout } from '#src/components/Layout/Layout.tsx';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Dropdown.module.css';

export type DropdownProps = HTMLPassthroughProps & {
  isOpen: Signal<boolean>;
  trigger: ComponentChildren;
  children: ComponentChildren;
  align?: 'left' | 'right';
  multiSelect?: boolean;
  className?: string;
};

let dropdownCounter = 0;

export function Dropdown(props: DropdownProps) {
  const { isOpen, trigger, children, align = 'left', multiSelect = false, className } = props;

  const htmlAttrs = collectHTMLAttrs(props);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const idRef = useRef(`fairfox-dropdown-${++dropdownCounter}`);
  const popoverId = idRef.current;

  useEffect(() => {
    triggerRef.current?.setAttribute('popovertarget', popoverId);
  }, [popoverId]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const onOverlayClose = (e: Event): void => {
      if (e instanceof CustomEvent && e.detail?.id === popoverId) {
        isOpen.value = false;
      }
    };
    menu.addEventListener('overlay:close', onOverlayClose);
    return () => {
      menu.removeEventListener('overlay:close', onOverlayClose);
    };
  }, [popoverId, isOpen]);

  useSignalEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    if (isOpen.value && !menu.matches(':popover-open')) {
      menu.showPopover();
    } else if (!isOpen.value && menu.matches(':popover-open')) {
      menu.hidePopover();
    }
  });

  const handleToggle = (e: Event): void => {
    if ('newState' in e) {
      isOpen.value = (e as unknown as { newState: string }).newState === 'open';
    }
  };

  const handleMenuClick = (): void => {
    if (!multiSelect) {
      isOpen.value = false;
    }
  };

  return (
    <div {...htmlAttrs} className={clsx(classes.dropdown, className)}>
      <button ref={triggerRef} type="button" className={classes.trigger}>
        {trigger}
      </button>
      <div
        ref={menuRef}
        id={popoverId}
        role="listbox"
        className={clsx(classes.menu, align === 'right' && classes.alignRight)}
        popover="auto"
        data-overlay-id={popoverId}
        onToggle={handleToggle}
        onClick={handleMenuClick}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            isOpen.value = false;
          }
        }}
      >
        <Layout rows="auto" gap="0">
          {children}
        </Layout>
      </div>
    </div>
  );
}
