/** @jsxImportSource preact */
// Docs sub-app — a flat list of research documents with a simple
// title + slug + body + project editor. Distinct from library (world
// bible for The Struggle) and todo captures (short inbox items).
//
// Two views: list (with a project filter + search) and edit (textarea
// body + rendered markdown preview side-by-side on wide screens,
// stacked on narrow).

import { $meshState } from '@fairfox/polly/mesh';
import { ActionInput, Badge, Button, Layout } from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { effect } from '@preact/signals';
import type { Document } from '#src/client/state.ts';
import {
  activeView,
  docsState,
  filterProject,
  searchQuery,
  selectedDocId,
} from '#src/client/state.ts';

// Subscribe to the same `todo:projects` CRDT the todo-v2 sub-app
// writes, so the project dropdown stays in sync without a
// cross-package import. A minimal local type shape keeps this file
// decoupled from todo-v2's evolving schema.
interface MinimalProject {
  [key: string]: unknown;
  pid: string;
  name: string;
}
interface MinimalProjectsDoc {
  [key: string]: unknown;
  projects: MinimalProject[];
}
const projectsState = $meshState<MinimalProjectsDoc>('todo:projects', { projects: [] });

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

const SELECT_STYLE = {
  padding: '0.35rem',
  border: '1px solid var(--polly-border)',
  borderRadius: '4px',
  fontSize: 'var(--polly-text-sm)',
};

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
      <Layout columns="auto 1fr 1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <label
          for="docs-filter-project"
          style={{ fontSize: 'var(--polly-text-sm)', color: 'var(--polly-text-muted)' }}
        >
          Project
        </label>
        <select
          id="docs-filter-project"
          value={filterProject.value}
          data-action="docs.filter-project"
          style={SELECT_STYLE}
        >
          <option value="">(any)</option>
          {projectOptions()
            .filter((pid) => pid !== '')
            .map((pid) => (
              <option key={pid} value={pid}>
                {projectNameFor(pid)}
              </option>
            ))}
        </select>
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
        <p style={{ color: 'var(--polly-text-muted)' }}>
          {docsState.value.docs.length === 0
            ? 'No documents yet. Create one to get started.'
            : 'No documents match the current filter.'}
        </p>
      ) : (
        <Layout rows="auto" gap="var(--polly-space-xs)">
          {docs.map((doc) => (
            <Layout
              key={doc.id}
              columns="1fr auto auto auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
              padding="var(--polly-space-sm) var(--polly-space-md)"
            >
              <button
                type="button"
                data-action="docs.open"
                data-action-id={doc.id}
                style={{
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <div style={{ fontWeight: 600 }}>{doc.title}</div>
                <div
                  style={{
                    fontSize: 'var(--polly-text-sm)',
                    color: 'var(--polly-text-muted)',
                    fontFamily: 'var(--polly-font-mono)',
                  }}
                >
                  {doc.slug}
                </div>
              </button>
              {doc.project && <Badge variant="info">{doc.project}</Badge>}
              <span
                style={{
                  fontSize: 'var(--polly-text-sm)',
                  color: 'var(--polly-text-muted)',
                }}
              >
                {formatDate(doc.updatedAt)}
              </span>
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
        <p>Document not found. It may have been deleted on another device.</p>
        <Button label="Back to list" tier="secondary" data-action="docs.back-to-list" />
      </Layout>
    );
  }
  return (
    <Layout rows="auto auto auto 1fr" gap="var(--polly-space-md)">
      <Layout columns="auto 1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <Button label="← Back" tier="tertiary" size="small" data-action="docs.back-to-list" />
        <span style={{ fontSize: 'var(--polly-text-sm)', color: 'var(--polly-text-muted)' }}>
          Updated {formatDate(doc.updatedAt)}
        </span>
        <Button
          label="Delete"
          tier="tertiary"
          size="small"
          color="danger"
          data-action="docs.delete"
          data-action-id={doc.id}
        />
      </Layout>
      <Layout columns="1fr 1fr 1fr" gap="var(--polly-space-sm)" alignItems="center">
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
        <select
          value={doc.project}
          data-action="docs.project"
          data-action-id={doc.id}
          style={SELECT_STYLE}
          aria-label="Project"
        >
          <option value="">(no project)</option>
          {projectOptions()
            .filter((pid) => pid !== '')
            .map((pid) => (
              <option key={pid} value={pid}>
                {projectNameFor(pid)}
              </option>
            ))}
        </select>
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
        <h1 style={{ margin: 0 }}>Docs</h1>
        <HubBack />
      </Layout>
      <div>{activeView.value === 'edit' ? <EditView /> : <ListView />}</div>
    </Layout>
  );
}
