// Action registry for the Agenda sub-app.
//
// Handlers mutate the $meshState agenda document. Changes propagate
// automatically to every connected peer via the CRDT sync layer.
// Draft-form state (kind / name / recurrence / room / time / points)
// lives on local signals and only lands in mesh state when the user
// presses Add.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { agendaViewSignals } from '#src/client/App.tsx';
import type {
  AgendaItem,
  AgendaItemKind,
  Completion,
  RecurrenceType,
  SnoozeKind,
} from '#src/client/state.ts';
import {
  activeTab,
  agenda,
  fairnessWindowDays,
  itemDraft,
  resetItemDraft,
} from '#src/client/state.ts';

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

const RECURRENCE_SET = new Set<string>(['once', 'daily', 'weekdays', 'interval']);
function isRecurrence(s: string): s is RecurrenceType {
  return RECURRENCE_SET.has(s);
}

function isKind(s: string): s is AgendaItemKind {
  return s === 'chore' || s === 'event';
}

/** Actions that mutate the `agenda:main` CRDT state and therefore
 * require `agenda.write`. View-state toggles stay unguarded.
 * Exported so the unified shell's dispatcher gates the same set. */
export const AGENDA_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'item.create',
  'item.create-from-draft',
  'item.delete',
  'item.toggle-active',
  'chore.done',
  'chore.snooze',
]);

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

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

  'item.create-from-draft': () => {
    const draft = itemDraft.value;
    const name = draft.name.trim();
    if (!name) {
      return;
    }
    if (draft.kind === 'event' && !draft.time) {
      // An event without a time is indistinguishable from a chore on
      // the Today view — the skill requires a time for events. Silent
      // no-op here; the UI's placeholder already flags "required".
      return;
    }
    const item: AgendaItem = {
      id: generateId(),
      kind: draft.kind,
      name,
      recurrence: draft.recurrence,
      points: Math.max(0, Math.min(10, Math.round(draft.points))),
      active: true,
    };
    if (draft.room) {
      item.room = draft.room;
    }
    if (draft.time) {
      item.time = draft.time;
    }
    if (draft.recurrence === 'weekdays') {
      item.recurrenceDays = [...draft.recurrenceDays];
    }
    if (draft.recurrence === 'interval') {
      const n = Number(draft.recurrenceInterval);
      item.recurrenceInterval = Number.isFinite(n) && n > 0 ? Math.round(n) : 7;
    }
    if (draft.recurrence === 'once') {
      if (draft.onceDate) {
        item.onceDate = draft.onceDate;
      }
    }
    agenda.value = {
      ...agenda.value,
      items: [...agenda.value.items, item],
    };
    resetItemDraft();
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

  'agenda.tab': (ctx) => {
    const id = ctx.data.id;
    if (id === 'today' || id === 'items' || id === 'fairness') {
      activeTab.value = id;
    }
  },

  'items.toggle-archived': () => {
    agendaViewSignals.showArchived.value = !agendaViewSignals.showArchived.value;
  },

  'fairness.window': (ctx) => {
    const n = Number(ctx.data.days);
    if (Number.isFinite(n) && n > 0 && n <= 365) {
      fairnessWindowDays.value = Math.round(n);
    }
  },

  'draft.kind': (ctx) => {
    const k = ctx.data.kind;
    if (k && isKind(k)) {
      itemDraft.value = { ...itemDraft.value, kind: k };
    }
  },

  'draft.name': (ctx) => {
    itemDraft.value = { ...itemDraft.value, name: ctx.data.value ?? '' };
  },

  'draft.recurrence': (ctx) => {
    const r = ctx.data.recurrence;
    if (r && isRecurrence(r)) {
      itemDraft.value = { ...itemDraft.value, recurrence: r };
    }
  },

  'draft.weekday': (ctx) => {
    const idx = Number(ctx.data.index);
    if (!Number.isFinite(idx) || idx < 0 || idx > 6) {
      return;
    }
    const days = [...itemDraft.value.recurrenceDays];
    days[idx] = !days[idx];
    itemDraft.value = { ...itemDraft.value, recurrenceDays: days };
  },

  'draft.interval': (ctx) => {
    const n = Number(ctx.data.value);
    if (Number.isFinite(n) && n > 0) {
      itemDraft.value = { ...itemDraft.value, recurrenceInterval: Math.round(n) };
    }
  },

  'draft.once-date': (ctx) => {
    itemDraft.value = { ...itemDraft.value, onceDate: (ctx.data.value ?? '').trim() };
  },

  'draft.time': (ctx) => {
    itemDraft.value = { ...itemDraft.value, time: (ctx.data.value ?? '').trim() };
  },

  'draft.points': (ctx) => {
    const n = Number(ctx.data.value);
    if (Number.isFinite(n)) {
      itemDraft.value = { ...itemDraft.value, points: Math.max(0, Math.min(10, Math.round(n))) };
    }
  },

  'draft.room': (ctx) => {
    itemDraft.value = { ...itemDraft.value, room: ctx.data.value ?? '' };
  },
};
