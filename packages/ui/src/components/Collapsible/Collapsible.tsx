/** @jsxImportSource preact */
// Collapsible primitive for @fairfox/ui.
//
// Wraps native <details>/<summary> elements. A custom arrow rotates
// on open via a CSS ::before pseudo-element. Colors from tokens.

import { clsx } from 'clsx';
import type { ComponentChildren } from 'preact';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Collapsible.module.css';

export type CollapsibleProps = HTMLPassthroughProps & {
  summary: string;
  children: ComponentChildren;
  defaultOpen?: boolean;
  className?: string;
};

export function Collapsible(props: CollapsibleProps) {
  const { summary, children, defaultOpen = false, className } = props;

  const htmlAttrs = collectHTMLAttrs(props);

  return (
    <details {...htmlAttrs} className={clsx(classes.collapsible, className)} open={defaultOpen}>
      <summary className={classes.summary}>{summary}</summary>
      <div className={classes.content}>{children}</div>
    </details>
  );
}
