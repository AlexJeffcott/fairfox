// Action registry for the Library sub-app.
//
// Handlers mutate the libraryState $meshState document. Changes propagate
// automatically to every connected peer via the CRDT sync layer.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import type { Doc, Ref } from '#src/client/state.ts';
import { libraryState } from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

  'ref.create': (ctx) => {
    const title = ctx.data.value;
    if (!title) {
      return;
    }
    const ref: Ref = {
      id: generateId('R'),
      title,
      author: '',
      form: 'prose',
      tags: [],
      body: '',
      notes: '',
    };
    libraryState.value = {
      ...libraryState.value,
      refs: [...libraryState.value.refs, ref],
    };
  },

  'ref.update': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    const updates: Partial<Ref> = {};
    if (ctx.data.body !== undefined) {
      updates.body = ctx.data.body;
    }
    if (ctx.data.notes !== undefined) {
      updates.notes = ctx.data.notes;
    }
    libraryState.value = {
      ...libraryState.value,
      refs: libraryState.value.refs.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    };
  },

  'ref.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.value = {
      ...libraryState.value,
      refs: libraryState.value.refs.filter((r) => r.id !== id),
    };
  },

  'doc.create': (ctx) => {
    const title = ctx.data.value;
    if (!title) {
      return;
    }
    const doc: Doc = {
      id: generateId('D'),
      path: '',
      category: 'world',
      title,
      content: '',
      lastModified: new Date().toISOString(),
    };
    libraryState.value = {
      ...libraryState.value,
      docs: [...libraryState.value.docs, doc],
    };
  },

  'doc.update': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    const updates: Partial<Doc> = {};
    if (ctx.data.content !== undefined) {
      updates.content = ctx.data.content;
    }
    if (Object.keys(updates).length > 0) {
      updates.lastModified = new Date().toISOString();
    }
    libraryState.value = {
      ...libraryState.value,
      docs: libraryState.value.docs.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    };
  },

  'doc.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.value = {
      ...libraryState.value,
      docs: libraryState.value.docs.filter((d) => d.id !== id),
    };
  },

  'library.tab': () => {
    // Tab changes handled by local signal in App — no CRDT mutation.
  },
};
