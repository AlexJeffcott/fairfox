/** @jsxImportSource preact */
// Skeleton loading placeholder for @fairfox/ui.
//
// Renders a shimmering placeholder in three variants: text (1em tall,
// full width), rect (100px tall), and circle (40x40). A CSS gradient
// slides left-to-right over 1.5s infinite to convey loading state.

import { clsx } from 'clsx';
import classes from './Skeleton.module.css';

export type SkeletonVariant = 'text' | 'rect' | 'circle';

export type SkeletonProps = {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
};

function resolveSize(value: string | number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return `${value}px`;
  }
  return value;
}

function getVariantClass(variant: SkeletonVariant): string {
  if (variant === 'circle') {
    return classes.circle;
  }
  if (variant === 'rect') {
    return classes.rect;
  }
  return classes.text;
}

export function Skeleton(props: SkeletonProps) {
  const { variant = 'text', width, height, className } = props;

  const style: Record<string, string> = {};
  const resolvedWidth = resolveSize(width);
  const resolvedHeight = resolveSize(height);
  if (resolvedWidth !== undefined) {
    style.width = resolvedWidth;
  }
  if (resolvedHeight !== undefined) {
    style.height = resolvedHeight;
  }

  return (
    <span
      className={clsx(classes.skeleton, getVariantClass(variant), className)}
      style={style}
      aria-hidden="true"
    />
  );
}
