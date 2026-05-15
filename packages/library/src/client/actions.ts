// Action registry for the Library sub-app.
//
// Handlers mutate the libraryState $meshState document. Changes propagate
// automatically to every connected peer via the CRDT sync layer.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { setActiveTab, setSelectedDocId, setSelectedRefId } from '#src/client/App.tsx';
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
    libraryState.handle?.change((doc) => {
      doc.refs.push(ref);
    });
  },

  'ref.update': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.handle?.change((doc) => {
      const target = doc.refs.find((r) => r.id === id);
      if (!target) {
        return;
      }
      if (ctx.data.body !== undefined) {
        target.body = ctx.data.body;
      }
      if (ctx.data.notes !== undefined) {
        target.notes = ctx.data.notes;
      }
    });
  },

  'ref.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.handle?.change((doc) => {
      const idx = doc.refs.findIndex((r) => r.id === id);
      if (idx >= 0) {
        doc.refs.splice(idx, 1);
      }
    });
  },

  'doc.create': (ctx) => {
    const title = ctx.data.value;
    if (!title) {
      return;
    }
    const newDoc: Doc = {
      id: generateId('D'),
      path: '',
      category: 'world',
      title,
      content: '',
      lastModified: new Date().toISOString(),
    };
    libraryState.handle?.change((doc) => {
      doc.docs.push(newDoc);
    });
  },

  'doc.update': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.handle?.change((doc) => {
      const target = doc.docs.find((d) => d.id === id);
      if (!target) {
        return;
      }
      let touched = false;
      if (ctx.data.content !== undefined) {
        target.content = ctx.data.content;
        touched = true;
      }
      if (touched) {
        target.lastModified = new Date().toISOString();
      }
    });
  },

  'doc.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.handle?.change((doc) => {
      const idx = doc.docs.findIndex((d) => d.id === id);
      if (idx >= 0) {
        doc.docs.splice(idx, 1);
      }
    });
  },

  'library.tab': (ctx) => {
    if (ctx.data.id) {
      setActiveTab(ctx.data.id);
    }
  },

  'ref.open': (ctx) => {
    if (ctx.data.id) {
      setSelectedRefId(ctx.data.id);
    }
  },
  'ref.close': () => {
    setSelectedRefId(null);
  },
  'ref.delete-and-close': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.handle?.change((doc) => {
      const idx = doc.refs.findIndex((r) => r.id === id);
      if (idx >= 0) {
        doc.refs.splice(idx, 1);
      }
    });
    setSelectedRefId(null);
  },

  'doc.open': (ctx) => {
    if (ctx.data.id) {
      setSelectedDocId(ctx.data.id);
    }
  },
  'doc.close': () => {
    setSelectedDocId(null);
  },
  'doc.delete-and-close': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    libraryState.handle?.change((doc) => {
      const idx = doc.docs.findIndex((d) => d.id === id);
      if (idx >= 0) {
        doc.docs.splice(idx, 1);
      }
    });
    setSelectedDocId(null);
  },
};
