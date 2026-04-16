/** @jsxImportSource preact */
// Modal primitive for @fairfox/ui.
//
// Uses a native <dialog> element with showModal()/close(). Three close
// triggers: Escape (native dialog behaviour), backdrop click (detected
// when e.target is the dialog itself), and the overlay:close custom
// event from the global event delegator. Size variants set max-width.
// Internal layout of title + content + footer uses Layout.

import type { ReadonlySignal, Signal } from '@preact/signals';
import { useSignalEffect } from '@preact/signals';
import { clsx } from 'clsx';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Layout } from '#src/components/Layout/Layout.tsx';
import classes from './Modal.module.css';

export type ModalSize = 'small' | 'medium' | 'large';

export type ModalProps = {
  isOpen: Signal<boolean> | ReadonlySignal<boolean>;
  onClose: () => void;
  triggerId?: string;
  title?: string | ComponentChildren;
  children: ComponentChildren;
  footer?: ComponentChildren;
  size?: ModalSize;
  className?: string;
};

function getSizeClass(size: ModalSize): string {
  if (size === 'small') {
    return classes.small;
  }
  if (size === 'large') {
    return classes.large;
  }
  return classes.medium;
}

export function Modal(props: ModalProps) {
  const { isOpen, onClose, triggerId, title, children, footer, size = 'medium', className } = props;

  const dialogRef = useRef<HTMLDialogElement>(null);

  useSignalEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (isOpen.value && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen.value && dialog.open) {
      dialog.close();
    }
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !triggerId) {
      return;
    }
    const onOverlayClose = (e: Event): void => {
      if (e instanceof CustomEvent && e.detail?.id === triggerId) {
        onClose();
      }
    };
    dialog.addEventListener('overlay:close', onOverlayClose);
    return () => {
      dialog.removeEventListener('overlay:close', onOverlayClose);
    };
  }, [triggerId, onClose]);

  const handleClick = (e: JSX.TargetedMouseEvent<HTMLDialogElement>): void => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={clsx(classes.modal, getSizeClass(size), className)}
      data-overlay-id={triggerId}
      onClick={handleClick}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      onClose={onClose}
    >
      <div className={classes.inner}>
        <Layout rows="auto 1fr auto" gap="var(--space-md)">
          {title !== undefined && (
            <header className={classes.header}>
              {typeof title === 'string' ? <h2 className={classes.title}>{title}</h2> : title}
            </header>
          )}
          <div className={classes.body}>{children}</div>
          {footer !== undefined && <footer className={classes.footer}>{footer}</footer>}
        </Layout>
      </div>
    </dialog>
  );
}
