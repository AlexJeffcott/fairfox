/** @jsxImportSource preact */
// Library sub-app — two views: Refs and Docs.
// All state from the $meshState library document.

import { PairingBanner } from '@fairfox/shared/pairing-banner';
import { Badge, Button, Input, Layout, Tabs } from '@fairfox/ui';
import { useSignal } from '@preact/signals';
import type { Doc, DocCategory } from '#src/client/state.ts';
import { libraryState } from '#src/client/state.ts';

type ViewId = 'refs' | 'docs';

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
  const selectedId = useSignal<string | null>(null);
  const refs = libraryState.value.refs;
  const selected = refs.find((r) => r.id === selectedId.value);

  return (
    <Layout rows="auto" gap="var(--space-md)">
      <Input
        value=""
        variant="single"
        action="ref.create"
        saveOn="enter"
        placeholder="Add a reference..."
        markdown={false}
      />
      {refs.map((ref) => (
        <Layout key={ref.id} columns="1fr auto auto auto" gap="var(--space-sm)" align="center">
          <Layout rows="auto" gap="0">
            <strong>{ref.title}</strong>
            {ref.author && (
              <span style={{ fontSize: 'var(--font-sm)', color: 'var(--txt-secondary)' }}>
                {ref.author}
              </span>
            )}
          </Layout>
          <Badge variant={FORM_COLORS[ref.form]}>{ref.form}</Badge>
          <Button
            label="View"
            size="small"
            tier="tertiary"
            data-action="game.inspect"
            data-action-id={ref.id}
          />
          <Button
            label="Delete"
            size="small"
            tier="tertiary"
            color="error"
            data-action="ref.delete"
            data-action-id={ref.id}
          />
        </Layout>
      ))}
      {selected && (
        <Layout rows="auto" gap="var(--space-sm)">
          <h3>{selected.title}</h3>
          <Input
            value={selected.body}
            variant="multi"
            action="noop"
            readonly={true}
            markdown={true}
          />
        </Layout>
      )}
      {refs.length === 0 && <p style={{ color: 'var(--txt-secondary)' }}>No references yet.</p>}
    </Layout>
  );
}

function DocsView() {
  const selectedId = useSignal<string | null>(null);
  const docs = libraryState.value.docs;
  const selected = docs.find((d) => d.id === selectedId.value);

  const grouped: Record<DocCategory, Doc[]> = {
    world: docs.filter((d) => d.category === 'world'),
    structure: docs.filter((d) => d.category === 'structure'),
    interface: docs.filter((d) => d.category === 'interface'),
  };

  return (
    <Layout rows="auto" gap="var(--space-md)">
      <Input
        value=""
        variant="single"
        action="doc.create"
        saveOn="enter"
        placeholder="Add a document..."
        markdown={false}
      />
      {(['world', 'structure', 'interface'] as const).map((category) => {
        const group = grouped[category];
        if (group.length === 0) {
          return null;
        }
        return (
          <Layout key={category} rows="auto" gap="var(--space-xs)">
            <h3>
              {CATEGORY_LABELS[category]} ({group.length})
            </h3>
            {group.map((doc) => (
              <Layout key={doc.id} columns="1fr auto" gap="var(--space-sm)" align="center">
                <span>{doc.title}</span>
                <Button
                  label="Delete"
                  size="small"
                  tier="tertiary"
                  color="error"
                  data-action="doc.delete"
                  data-action-id={doc.id}
                />
              </Layout>
            ))}
          </Layout>
        );
      })}
      {selected && (
        <Layout rows="auto" gap="var(--space-sm)">
          <h3>{selected.title}</h3>
          <Input
            value={selected.content}
            variant="multi"
            action="noop"
            readonly={true}
            markdown={true}
          />
        </Layout>
      )}
      {docs.length === 0 && <p style={{ color: 'var(--txt-secondary)' }}>No documents yet.</p>}
    </Layout>
  );
}

export function App() {
  const activeTab = useSignal<ViewId>('refs');

  return (
    <Layout rows="auto auto 1fr" gap="var(--space-lg)" padding="var(--space-lg)">
      <PairingBanner />
      <Layout rows="auto" gap="var(--space-md)">
        <h1>Library</h1>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="library.tab" />
      </Layout>
      <div>
        {activeTab.value === 'refs' && <RefsView />}
        {activeTab.value === 'docs' && <DocsView />}
      </div>
    </Layout>
  );
}
