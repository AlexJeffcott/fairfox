/** @jsxImportSource preact */
// Badge primitive for @fairfox/ui.
//
// A small inline label with color variants mapped to the status tokens.
// Renders as a simple <span> with padding and border-radius.

import { clsx } from 'clsx';
import type { ComponentChildren } from 'preact';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Badge.module.css';

export type BadgeVariant = 'default' | 'info' | 'success' | 'warning' | 'error';

export type BadgeProps = HTMLPassthroughProps & {
  children: ComponentChildren;
  variant?: BadgeVariant;
  className?: string;
};

function getVariantClass(variant: BadgeVariant): string | undefined {
  if (variant === 'info') {
    return classes.info;
  }
  if (variant === 'success') {
    return classes.success;
  }
  if (variant === 'warning') {
    return classes.warning;
  }
  if (variant === 'error') {
    return classes.error;
  }
  return undefined;
}

export function Badge(props: BadgeProps) {
  const { children, variant = 'default', className } = props;

  const htmlAttrs = collectHTMLAttrs(props);

  return (
    <span {...htmlAttrs} className={clsx(classes.badge, getVariantClass(variant), className)}>
      {children}
    </span>
  );
}
