// Action registry — maps data-action names to handler functions.
//
// Every interactive element in the UI declares its intent via a
// data-action attribute (e.g., data-action="item.add"). The global
// event delegator resolves the action name and calls the matching
// handler from this registry. Handlers mutate $meshState documents;
// the CRDT sync layer propagates changes to every connected peer.
//
// Add new handlers here as the sub-app grows. The registry is a plain
// object — no runtime registration, no indirection.

import { appState } from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  'item.add': (ctx) => {
    const text = ctx.data.value;
    if (text) {
      appState.value = { items: [...appState.value.items, text] };
    }
  },

  'item.remove': (ctx) => {
    const index = Number(ctx.data.index);
    if (!Number.isNaN(index)) {
      const items = [...appState.value.items];
      items.splice(index, 1);
      appState.value = { items };
    }
  },
};
