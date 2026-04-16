// Action registry for the Agenda sub-app.
//
// Handlers mutate the $meshState agenda document. Changes propagate
// automatically to every connected peer via the CRDT sync layer.

import type { AgendaItem, Completion, SnoozeKind } from '#src/client/state.ts';
import { agenda } from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const SNOOZE_KINDS = new Set<string>(['snooze-1d', 'snooze-3d', 'snooze-7d']);

function isSnoozeKind(s: string): s is SnoozeKind {
  return SNOOZE_KINDS.has(s);
}

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  'item.create': (ctx) => {
    const name = ctx.data.value ?? ctx.data.name;
    const kind = ctx.data.kind === 'event' ? 'event' : 'chore';
    if (!name) {
      return;
    }
    const item: AgendaItem = {
      id: generateId(),
      kind,
      name,
      recurrence: 'daily',
      points: kind === 'chore' ? 1 : 0,
      active: true,
    };
    agenda.value = {
      ...agenda.value,
      items: [...agenda.value.items, item],
    };
  },

  'item.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    agenda.value = {
      ...agenda.value,
      items: agenda.value.items.filter((i) => i.id !== id),
    };
  },

  'item.toggle-active': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    agenda.value = {
      ...agenda.value,
      items: agenda.value.items.map((i) => (i.id === id ? { ...i, active: !i.active } : i)),
    };
  },

  'chore.done': (ctx) => {
    const itemId = ctx.data.itemId;
    const person = ctx.data.person;
    if (!itemId || !person) {
      return;
    }
    const completion: Completion = {
      id: generateId(),
      itemId,
      person,
      completedAt: new Date().toISOString(),
      kind: 'done',
    };
    agenda.value = {
      ...agenda.value,
      completions: [...agenda.value.completions, completion],
    };
  },

  'chore.snooze': (ctx) => {
    const itemId = ctx.data.itemId;
    const person = ctx.data.person;
    const days = ctx.data.days;
    if (!itemId || !person || !days) {
      return;
    }
    const kind = `snooze-${days}d`;
    if (!isSnoozeKind(kind)) {
      return;
    }
    const completion: Completion = {
      id: generateId(),
      itemId,
      person,
      completedAt: new Date().toISOString(),
      kind,
    };
    agenda.value = {
      ...agenda.value,
      completions: [...agenda.value.completions, completion],
    };
  },

  'agenda.tab': () => {
    // Tab changes are handled by the App component's local signal;
    // no CRDT mutation needed. The delegator still dispatches the
    // action, but the handler is intentionally empty.
  },
};
