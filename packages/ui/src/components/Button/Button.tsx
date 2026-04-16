/** @jsxImportSource preact */
// Button primitive for @fairfox/ui.
//
// The button is styled via a typed CSS module and accepts discriminated
// variants for tier (visual importance), color (semantic meaning), and
// size. It will render as a <button> by default and switch to an <a>
// when given an href. It refuses to accept onClick — event wiring lives
// exclusively in the data-action dispatch handled by the global event
// delegator (see src/event-delegation.ts and ADR 0002).
//
// When the button is given both an icon and a label, the two are
// arranged by a <Layout> with an auto-auto column template. The
// button's own CSS never uses flex or grid directly; that rule is
// enforced by scripts/check-layout-ban.ts and lives in the Layout
// primitive's CSS module instead (ADR 0005).

import { clsx } from 'clsx';
import type { ComponentChildren, VNode } from 'preact';
import { Layout } from '#src/components/Layout/Layout.tsx';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Button.module.css';

export type ButtonTier = 'primary' | 'secondary' | 'tertiary';
export type ButtonColor = 'default' | 'info' | 'success' | 'warning' | 'error';
export type ButtonSize = 'small' | 'normal' | 'large';

type BaseButtonProps = HTMLPassthroughProps & {
  id?: string;
  tier?: ButtonTier;
  color?: ButtonColor;
  size?: ButtonSize;
  disabled?: boolean;
  fullWidth?: boolean;
  circle?: boolean;
  className?: string;
  title?: string;
  icon?: VNode;
  label: ComponentChildren;
};

type ButtonAsButton = BaseButtonProps & {
  href?: never;
  target?: never;
  rel?: never;
  type?: 'button' | 'submit' | 'reset';
};

type ButtonAsLink = BaseButtonProps & {
  href: string;
  target?: string;
  rel?: string;
  type?: never;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function getTierClass(tier: ButtonTier): string {
  if (tier === 'primary') {
    return classes.tierPrimary;
  }
  if (tier === 'tertiary') {
    return classes.tierTertiary;
  }
  return classes.tierSecondary;
}

function getColorClass(color: ButtonColor): string | undefined {
  if (color === 'info') {
    return classes.colorInfo;
  }
  if (color === 'success') {
    return classes.colorSuccess;
  }
  if (color === 'warning') {
    return classes.colorWarning;
  }
  if (color === 'error') {
    return classes.colorError;
  }
  return undefined;
}

function getSizeClass(size: ButtonSize): string | undefined {
  if (size === 'small') {
    return classes.btnSmall;
  }
  if (size === 'large') {
    return classes.btnLarge;
  }
  return undefined;
}

export function Button(props: ButtonProps) {
  const {
    id,
    tier = 'secondary',
    color = 'default',
    size = 'normal',
    disabled = false,
    fullWidth = false,
    circle = false,
    className,
    title,
    icon,
    label,
  } = props;

  const buttonClass = clsx(
    classes.btn,
    getTierClass(tier),
    getColorClass(color),
    getSizeClass(size),
    circle && classes.btnCircle,
    fullWidth && classes.btnFullWidth,
    className
  );

  const htmlAttrs = collectHTMLAttrs(props);

  const content = icon ? (
    <Layout inline={true} columns="auto auto" gap="0.5em" align="center">
      {icon}
      <span>{label}</span>
    </Layout>
  ) : (
    label
  );

  if ('href' in props && props.href) {
    return (
      <a
        {...htmlAttrs}
        id={id}
        className={buttonClass}
        title={title}
        href={disabled ? undefined : props.href}
        target={'target' in props ? props.target : undefined}
        rel={'rel' in props ? props.rel : undefined}
        aria-disabled={disabled}
      >
        {content}
      </a>
    );
  }

  const resolvedType: 'button' | 'submit' | 'reset' =
    'type' in props && props.type ? props.type : 'button';

  return (
    <button
      {...htmlAttrs}
      id={id}
      className={buttonClass}
      title={title}
      type={resolvedType}
      disabled={disabled}
    >
      {content}
    </button>
  );
}
