/** @jsxImportSource preact */
// Tabs primitive for @fairfox/ui.
//
// A <nav> element containing tab buttons. The active tab gets
// aria-current="page" and a bottom border accent. Each button carries
// data-action and data-action-id for event delegation. The internal
// arrangement of tab buttons uses Layout (no flex/grid in this CSS).
// The nav scrolls horizontally with a hidden scrollbar.

import { clsx } from 'clsx';
import { Layout } from '#src/components/Layout/Layout.tsx';
import { collectHTMLAttrs, type HTMLPassthroughProps } from '#src/utils/html-attrs.ts';
import classes from './Tabs.module.css';

export type Tab = { id: string; label: string; disabled?: boolean };

export type TabsProps = HTMLPassthroughProps & {
  tabs: Tab[];
  activeTab: string;
  action?: string;
  className?: string;
};

export function Tabs(props: TabsProps) {
  const { tabs, activeTab, action, className } = props;

  const htmlAttrs = collectHTMLAttrs(props);

  return (
    <nav {...htmlAttrs} className={clsx(classes.tabs, className)}>
      <Layout columns={`repeat(${tabs.length}, auto)`} gap="0" align="end">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={clsx(classes.tab, activeTab === tab.id && classes.active)}
            disabled={tab.disabled}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            data-action={action}
            data-action-id={tab.id}
          >
            {tab.label}
          </button>
        ))}
      </Layout>
    </nav>
  );
}
