/** @jsxImportSource preact */
// Docs sub-app — a flat list of research documents with a simple
// title + slug + body + project editor. Distinct from library (world
// bible for The Struggle) and todo captures (short inbox items).
//
// Two views: list (with a project filter + search) and edit (textarea
// body + rendered markdown preview side-by-side on wide screens,
// stacked on narrow).

import { ActionInput, ActionSelect, Badge, Button, Code, Layout, Text } from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { projectsState } from '@fairfox/todo-v2/state';
import { effect } from '@preact/signals';
import type { Document } from '#src/client/state.ts';
import {
  activeView,
  docsState,
  filterProject,
  searchQuery,
  selectedDocId,
} from '#src/client/state.ts';

function projectOptions(): string[] {
  const projs = projectsState.value?.projects ?? [];
  return ['', ...projs.map((p) => p.pid)];
}

function projectNameFor(pid: string): string {
  if (!pid) {
    return '';
  }
  const projs = projectsState.value?.projects ?? [];
  const match = projs.find((p) => p.pid === pid);
  return match ? `${pid} — ${match.name}` : pid;
}

function projectSelectOptions(): { value: string; label: string }[] {
  return projectOptions()
    .filter((pid) => pid !== '')
    .map((pid) => ({ value: pid, label: projectNameFor(pid) }));
}

function matchesFilter(doc: Document, projectFilter: string, query: string): boolean {
  if (projectFilter && doc.project !== projectFilter) {
    return false;
  }
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  return (
    doc.title.toLowerCase().includes(needle) ||
    doc.slug.toLowerCase().includes(needle) ||
    doc.body.toLowerCase().includes(needle)
  );
}

function formatDate(iso: string): string {
  if (!iso) {
    return '';
  }
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function ListView() {
  const docs = docsState.value.docs
    .filter((d) => matchesFilter(d, filterProject.value, searchQuery.value))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Layout rows="auto auto auto" gap="var(--polly-space-md)">
      <Layout
        columns="auto 1fr 1fr auto"
        gap="var(--polly-space-sm)"
        alignItems="center"
        stackOnMobile={true}
      >
        <ActionSelect
          value={filterProject.value}
          action="docs.filter-project"
          label="Project"
          placeholder="(any)"
          options={projectSelectOptions()}
        />
        <ActionInput
          value={searchQuery.value}
          variant="single"
          action="docs.search"
          saveOn="blur"
          placeholder="Search title or body…"
          ariaLabel="Search docs"
        />
        <Button label="+ New doc" tier="primary" size="small" data-action="docs.create" />
      </Layout>
      {docs.length === 0 ? (
        <Text as="p" tone="muted">
          {docsState.value.docs.length === 0
            ? 'No documents yet. Create one to get started.'
            : 'No documents match the current filter.'}
        </Text>
      ) : (
        <Layout rows="auto" gap="var(--polly-space-xs)">
          {docs.map((doc) => (
            <Layout
              key={doc.id}
              columns="minmax(0, 1fr) auto auto auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
              padding="var(--polly-space-sm) var(--polly-space-md)"
            >
              <Button
                tier="tertiary"
                size="small"
                data-action="docs.open"
                data-action-id={doc.id}
                label={
                  <Layout rows="auto auto" gap="var(--polly-space-xs)" justifyItems="start">
                    <Text weight="bold">{doc.title}</Text>
                    <Code>{doc.slug}</Code>
                  </Layout>
                }
              />
              {doc.project && <Badge variant="info">{doc.project}</Badge>}
              <Text size="sm" tone="muted">
                {formatDate(doc.updatedAt)}
              </Text>
              <Button
                label="Delete"
                tier="tertiary"
                size="small"
                color="danger"
                data-action="docs.delete"
                data-action-id={doc.id}
              />
            </Layout>
          ))}
        </Layout>
      )}
    </Layout>
  );
}

function EditView() {
  const id = selectedDocId.value;
  const doc = id ? docsState.value.docs.find((d) => d.id === id) : undefined;
  if (!doc) {
    return (
      <Layout rows="auto auto" gap="var(--polly-space-sm)">
        <Text as="p">Document not found. It may have been deleted on another device.</Text>
        <Button label="Back to list" tier="secondary" data-action="docs.back-to-list" />
      </Layout>
    );
  }
  return (
    <Layout rows="auto auto auto 1fr" gap="var(--polly-space-md)">
      <Layout columns="auto minmax(0, 1fr) auto" gap="var(--polly-space-sm)" alignItems="center">
        <Button label="← Back" tier="tertiary" size="small" data-action="docs.back-to-list" />
        <Text size="sm" tone="muted">
          Updated {formatDate(doc.updatedAt)}
        </Text>
        <Button
          label="Delete"
          tier="tertiary"
          size="small"
          color="danger"
          data-action="docs.delete"
          data-action-id={doc.id}
        />
      </Layout>
      <Layout
        columns="1fr 1fr 1fr"
        gap="var(--polly-space-sm)"
        alignItems="center"
        stackOnMobile={true}
      >
        <ActionInput
          value={doc.title}
          variant="single"
          action="docs.title"
          saveOn="blur"
          placeholder="Title"
          ariaLabel="Title"
          data-action-id={doc.id}
        />
        <ActionInput
          value={doc.slug}
          variant="single"
          action="docs.slug"
          saveOn="blur"
          placeholder="slug-of-document"
          ariaLabel="Slug"
          data-action-id={doc.id}
        />
        <ActionSelect
          value={doc.project}
          action="docs.project"
          actionData={{ id: doc.id }}
          label="Project"
          placeholder="(no project)"
          options={projectSelectOptions()}
        />
      </Layout>
      <BodyEditor doc={doc} />
    </Layout>
  );
}

function BodyEditor({ doc }: { doc: Document }) {
  return (
    <ActionInput
      value={doc.body}
      variant="multi"
      action="docs.body"
      saveOn="blur"
      placeholder="Write in markdown…"
      ariaLabel="Body"
      data-action-id={doc.id}
    />
  );
}

let docsEffectsInstalled = false;

/** Publish the current docs view's page-context. */
export function installDocsEffects(): void {
  if (docsEffectsInstalled) {
    return;
  }
  docsEffectsInstalled = true;
  effect(() => {
    if (activeView.value === 'edit') {
      const id = selectedDocId.value;
      const doc = id ? docsState.value.docs.find((d) => d.id === id) : undefined;
      if (doc) {
        setPageContext({
          kind: 'doc',
          id: doc.id,
          label: doc.title || doc.slug || 'untitled',
        });
        return;
      }
    }
    const project = filterProject.value;
    const label = project ? `Docs · project ${project}` : 'Docs';
    setPageContext({ kind: 'docs-list', label });
  });
}

export function App() {
  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <Text as="h1" size="xl" weight="bold">
          Docs
        </Text>
        <HubBack />
      </Layout>
      <div>{activeView.value === 'edit' ? <EditView /> : <ListView />}</div>
    </Layout>
  );
}
