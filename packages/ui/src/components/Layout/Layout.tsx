/** @jsxImportSource preact */
// Layout primitive for @fairfox/ui.
//
// The Layout component is the only place in the UI where flex and grid
// layout properties are allowed. Every other primitive that needs to
// arrange children in a row, column, or grid wraps them in a <Layout>.
// A repo-level check script (scripts/check-layout-ban.ts) runs as part
// of the ui typecheck and fails the build if any CSS outside of this
// component's module uses display: flex|grid, align-items,
// justify-content, grid-template-*, or flex-*. The rule is inherited
// from Lingua and exists so that layout decisions are centralised and
// every sub-app inherits the same spacing and alignment vocabulary.
//
// Props map onto CSS custom properties that the module consumes:
// `columns`, `rows`, `gap`, `padding`, `align`, `justify`. Passing a
// raw CSS value for gap/padding ("0.5em", "var(--space-md)") keeps the
// Layout composable with whatever token system the consuming sub-app
// uses, without forcing one onto it.

import { clsx } from 'clsx';
import type { ComponentChildren } from 'preact';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Layout.module.css';

export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch';
export type LayoutJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around';

export type LayoutProps = HTMLPassthroughProps & {
  id?: string;
  rows?: string;
  columns?: string;
  gap?: string;
  padding?: string;
  align?: LayoutAlign;
  justify?: LayoutJustify;
  justifyItems?: LayoutAlign;
  inline?: boolean;
  fullWidth?: boolean;
  fullHeight?: boolean;
  className?: string;
  children?: ComponentChildren;
};

export function Layout(props: LayoutProps) {
  const {
    id,
    rows,
    columns,
    gap,
    padding,
    align,
    justify,
    justifyItems,
    inline = false,
    fullWidth = false,
    fullHeight = false,
    className,
    children,
  } = props;

  const style: Record<string, string> = {};
  if (rows !== undefined) {
    style['--l-rows'] = rows;
  }
  if (columns !== undefined) {
    style['--l-cols'] = columns;
  }
  if (gap !== undefined) {
    style['--l-gap'] = gap;
  }
  if (padding !== undefined) {
    style['--l-padding'] = padding;
  }
  if (align !== undefined) {
    style['--l-align'] = align;
  }
  if (justify !== undefined) {
    style['--l-justify'] = justify;
  }
  if (justifyItems !== undefined) {
    style['--l-justify-items'] = justifyItems;
  }

  const layoutClass = clsx(
    classes.layout,
    inline && classes.inline,
    fullWidth && classes.fullWidth,
    fullHeight && classes.fullHeight,
    className
  );

  const htmlAttrs = collectHTMLAttrs(props);

  return (
    <div {...htmlAttrs} id={id} className={layoutClass} style={style}>
      {children}
    </div>
  );
}
