/** @jsxImportSource preact */
// Toast notification primitive for @fairfox/ui.
//
// Returns null when not visible. When visible, renders a fixed-position
// notification at the bottom-left of the viewport with a slide-in
// animation. Variant colors map to the status tokens.

import { clsx } from 'clsx';
import classes from './Toast.module.css';

export type ToastVariant = 'success' | 'error' | 'info';

export type ToastProps = {
  message: string;
  variant?: ToastVariant;
  visible?: boolean;
  className?: string;
};

function getVariantClass(variant: ToastVariant): string {
  if (variant === 'success') {
    return classes.success;
  }
  if (variant === 'error') {
    return classes.error;
  }
  return classes.info;
}

export function Toast(props: ToastProps) {
  const { message, variant = 'info', visible = false, className } = props;

  if (!visible) {
    return null;
  }

  return (
    <div
      className={clsx(classes.toast, getVariantClass(variant), className)}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
