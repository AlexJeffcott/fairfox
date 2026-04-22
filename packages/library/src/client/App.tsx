/** @jsxImportSource preact */
// Library sub-app — two views: Refs and Docs.
// All state from the $meshState library document.

import { ActionInput, Badge, Button, Layout, Tabs } from '@fairfox/polly/ui';
import { renderMarkdown } from '@fairfox/polly/ui/markdown';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { signal, useSignalEffect } from '@preact/signals';
import type { Doc, DocCategory } from '#src/client/state.ts';
import { libraryState } from '#src/client/state.ts';

export type ViewId = 'refs' | 'docs';

// Module-level view state so the unified dispatcher can flip tabs
// and open/close the detail pane via `data-action` handlers. Earlier
// these were `useSignal`s inside the App component, which the
// dispatcher couldn't reach — clicking a tab or a "View" button
// fired actions that no handler could actually consume.
export const activeTab = signal<ViewId>('refs');
export const selectedRefId = signal<string | null>(null);
export const selectedDocId = signal<string | null>(null);

function isViewId(v: string): v is ViewId {
  return v === 'refs' || v === 'docs';
}

export function setActiveTab(v: string): void {
  if (isViewId(v)) {
    activeTab.value = v;
    // Closing detail panes on tab switch keeps the URL-less view
    // state consistent — otherwise switching tabs leaves a stale
    // "selected" item ready to reappear on return.
    selectedRefId.value = null;
    selectedDocId.value = null;
  }
}

export function setSelectedRefId(v: string | null): void {
  selectedRefId.value = v;
}

export function setSelectedDocId(v: string | null): void {
  selectedDocId.value = v;
}

const TAB_LIST = [
  { id: 'refs', label: 'Refs' },
  { id: 'docs', label: 'Docs' },
];

const FORM_COLORS = {
  prose: 'default',
  poem: 'info',
} as const;

const CATEGORY_LABELS: Record<DocCategory, string> = {
  world: 'World',
  structure: 'Structure',
  interface: 'Interface',
};

function RefsView() {
  const refs = libraryState.value.refs;
  const selected = refs.find((r) => r.id === selectedRefId.value);

  if (selected) {
    return (
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="auto 1fr auto" gap="var(--polly-space-sm)" alignItems="center">
          <Button label="← Back" tier="tertiary" size="small" data-action="ref.close" />
          <h3 style={{ margin: 0 }}>{selected.title}</h3>
          <Button
            label="Delete"
            size="small"
            tier="tertiary"
            color="danger"
            data-action="ref.delete-and-close"
            data-action-id={selected.id}
          />
        </Layout>
        {selected.author && (
          <span style={{ color: 'var(--polly-text-muted)' }}>{selected.author}</span>
        )}
        <Layout columns="auto auto" gap="var(--polly-space-xs)" justifyContent="start">
          <Badge variant={FORM_COLORS[selected.form]}>{selected.form}</Badge>
          {selected.tags.map((t) => (
            <Badge key={t} variant="default">
              {t}
            </Badge>
          ))}
        </Layout>
        <div style={{ lineHeight: '1.6' }}>{renderMarkdown(selected.body)}</div>
        {selected.notes && (
          <Layout rows="auto" gap="var(--polly-space-xs)">
            <h4 style={{ margin: 0 }}>Notes</h4>
            <div style={{ color: 'var(--polly-text-muted)' }}>{renderMarkdown(selected.notes)}</div>
          </Layout>
        )}
      </Layout>
    );
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <ActionInput
        value=""
        variant="single"
        action="ref.create"
        saveOn="enter"
        placeholder="Add a reference..."
      />
      {refs.map((ref) => (
        <Layout
          key={ref.id}
          columns="1fr auto auto auto"
          gap="var(--polly-space-sm)"
          alignItems="center"
        >
          <Layout rows="auto" gap="0">
            <strong>{ref.title}</strong>
            {ref.author && (
              <span style={{ fontSize: 'var(--polly-text-sm)', color: 'var(--polly-text-muted)' }}>
                {ref.author}
              </span>
            )}
          </Layout>
          <Badge variant={FORM_COLORS[ref.form]}>{ref.form}</Badge>
          <Button
            label="View"
            size="small"
            tier="tertiary"
            data-action="ref.open"
            data-action-id={ref.id}
          />
          <Button
            label="Delete"
            size="small"
            tier="tertiary"
            color="danger"
            data-action="ref.delete"
            data-action-id={ref.id}
          />
        </Layout>
      ))}
      {refs.length === 0 && <p style={{ color: 'var(--polly-text-muted)' }}>No references yet.</p>}
    </Layout>
  );
}

function DocsView() {
  const docs = libraryState.value.docs;
  const selected = docs.find((d) => d.id === selectedDocId.value);

  if (selected) {
    return (
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="auto 1fr auto" gap="var(--polly-space-sm)" alignItems="center">
          <Button label="← Back" tier="tertiary" size="small" data-action="doc.close" />
          <h3 style={{ margin: 0 }}>{selected.title}</h3>
          <Button
            label="Delete"
            size="small"
            tier="tertiary"
            color="danger"
            data-action="doc.delete-and-close"
            data-action-id={selected.id}
          />
        </Layout>
        <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
          {CATEGORY_LABELS[selected.category]} · {selected.path}
        </span>
        <div style={{ lineHeight: '1.6' }}>{renderMarkdown(selected.content)}</div>
      </Layout>
    );
  }

  const grouped: Record<DocCategory, Doc[]> = {
    world: docs.filter((d) => d.category === 'world'),
    structure: docs.filter((d) => d.category === 'structure'),
    interface: docs.filter((d) => d.category === 'interface'),
  };

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <ActionInput
        value=""
        variant="single"
        action="doc.create"
        saveOn="enter"
        placeholder="Add a document..."
      />
      {(['world', 'structure', 'interface'] as const).map((category) => {
        const group = grouped[category];
        if (group.length === 0) {
          return null;
        }
        return (
          <Layout key={category} rows="auto" gap="var(--polly-space-xs)">
            <h3>
              {CATEGORY_LABELS[category]} ({group.length})
            </h3>
            {group.map((doc) => (
              <Layout
                key={doc.id}
                columns="1fr auto auto"
                gap="var(--polly-space-sm)"
                alignItems="center"
              >
                <span>{doc.title}</span>
                <Button
                  label="View"
                  size="small"
                  tier="tertiary"
                  data-action="doc.open"
                  data-action-id={doc.id}
                />
                <Button
                  label="Delete"
                  size="small"
                  tier="tertiary"
                  color="danger"
                  data-action="doc.delete"
                  data-action-id={doc.id}
                />
              </Layout>
            ))}
          </Layout>
        );
      })}
      {docs.length === 0 && <p style={{ color: 'var(--polly-text-muted)' }}>No documents yet.</p>}
    </Layout>
  );
}

export function App() {
  useSignalEffect(() => {
    const tab = activeTab.value;
    setPageContext({ kind: 'library', label: `Library · ${tab}` });
  });
  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <h1 style={{ margin: 0 }}>Library</h1>
          <HubBack />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="library.tab" />
      </Layout>
      <div>
        {activeTab.value === 'refs' && <RefsView />}
        {activeTab.value === 'docs' && <DocsView />}
      </div>
    </Layout>
  );
}
