// Action registry for the Docs sub-app. Pure write handlers that
// mutate the `docs:main` $meshState document and view-state signals.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import type { Document } from '#src/client/state.ts';
import {
  activeView,
  docsState,
  filterProject,
  searchQuery,
  selectedDocId,
  slugify,
  uniqueSlug,
} from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateDoc(id: string, patch: Partial<Document>): void {
  const now = new Date().toISOString();
  docsState.value = {
    ...docsState.value,
    docs: docsState.value.docs.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now } : d)),
  };
}

/** Actions that mutate `docs:main`. The unified shell's dispatcher
 * gates the same set under the `docs.write` policy permission.
 * Currently that permission isn't defined in policy.ts; until it
 * is, writes are ungated just like tasks and agenda were during
 * their respective Phase-E windows. */
export const DOCS_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'docs.create',
  'docs.delete',
  'docs.update',
]);

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

  'docs.create': () => {
    const now = new Date().toISOString();
    const base = slugify('untitled') || 'untitled';
    const taken = new Set(docsState.value.docs.map((d) => d.slug));
    const doc: Document = {
      id: generateId(),
      title: 'Untitled',
      slug: uniqueSlug(base, taken),
      body: '',
      project: filterProject.value,
      createdAt: now,
      updatedAt: now,
    };
    docsState.value = {
      ...docsState.value,
      docs: [...docsState.value.docs, doc],
    };
    selectedDocId.value = doc.id;
    activeView.value = 'edit';
  },

  'docs.open': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    selectedDocId.value = id;
    activeView.value = 'edit';
  },

  'docs.back-to-list': () => {
    activeView.value = 'list';
    selectedDocId.value = null;
  },

  'docs.title': (ctx) => {
    const id = ctx.data.id;
    const value = ctx.data.value ?? '';
    if (!id) {
      return;
    }
    updateDoc(id, { title: value });
  },

  'docs.slug': (ctx) => {
    const id = ctx.data.id;
    const raw = ctx.data.value ?? '';
    if (!id) {
      return;
    }
    const cleaned = slugify(raw);
    if (!cleaned) {
      return;
    }
    const taken = new Set(docsState.value.docs.filter((d) => d.id !== id).map((d) => d.slug));
    if (taken.has(cleaned)) {
      return;
    }
    updateDoc(id, { slug: cleaned });
  },

  'docs.project': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    updateDoc(id, { project: ctx.data.value ?? '' });
  },

  'docs.body': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    updateDoc(id, { body: ctx.data.value ?? '' });
  },

  'docs.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    docsState.value = {
      ...docsState.value,
      docs: docsState.value.docs.filter((d) => d.id !== id),
    };
    if (selectedDocId.value === id) {
      selectedDocId.value = null;
      activeView.value = 'list';
    }
  },

  'docs.filter-project': (ctx) => {
    filterProject.value = ctx.data.value ?? '';
  },

  'docs.search': (ctx) => {
    searchQuery.value = ctx.data.value ?? '';
  },
};
