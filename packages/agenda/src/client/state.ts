// Agenda state — the household's shared view of events, chores, and
// completions. All state is a single $meshState CRDT document synced
// across every paired device. See ADR 0002 and ADR 0004.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import { signal } from '@preact/signals';

export type AgendaView = 'today' | 'items' | 'fairness';

/** Which tab the App component is rendering. Lifted out of a local
 * useSignal so the `agenda.tab` action handler can mutate it through
 * the same signal the component reads. */
export const activeTab = signal<AgendaView>('today');

export type AgendaItemKind = 'event' | 'chore';
export type RecurrenceType = 'once' | 'daily' | 'weekdays' | 'interval';
export type SnoozeKind = 'snooze-1d' | 'snooze-3d' | 'snooze-7d';

export interface AgendaItem {
  [key: string]: unknown;
  id: string;
  kind: AgendaItemKind;
  name: string;
  room?: string;
  time?: string;
  recurrence: RecurrenceType;
  recurrenceDays?: boolean[];
  recurrenceInterval?: number;
  onceDate?: string;
  points: number;
  active: boolean;
}

export interface Completion {
  [key: string]: unknown;
  id: string;
  itemId: string;
  person: string;
  completedAt: string;
  kind: 'done' | SnoozeKind;
}

export interface AgendaDoc {
  [key: string]: unknown;
  items: AgendaItem[];
  completions: Completion[];
}

export const agenda = $meshState<AgendaDoc>('agenda:main', {
  items: [],
  completions: [],
});
