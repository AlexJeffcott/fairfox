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

/** Closed list of household rooms. The skill defines this set; the
 * UI's room picker renders exactly these values so a chore's room
 * never drifts into a free-form label. */
export const ROOMS = [
  'kitchen',
  'master_bedroom',
  'leos_bedroom',
  'music_room',
  'music_room_balcony',
  'utility_room',
  'living_room',
  'kitchen_balcony',
  'guest_bathroom',
  'main_bathroom',
  'entrance_hall',
] as const;
export type Room = (typeof ROOMS)[number];

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

/** Draft buffer for the Items-tab create form. Lives on a plain
 * signal (not $meshState) because a half-typed chore name shouldn't
 * replicate to every peer before the user presses Add. */
export interface ItemDraft {
  kind: AgendaItemKind;
  name: string;
  recurrence: RecurrenceType;
  recurrenceDays: boolean[];
  recurrenceInterval: number;
  onceDate: string;
  time: string;
  room: string;
  points: number;
}

const DEFAULT_DRAFT: ItemDraft = {
  kind: 'chore',
  name: '',
  recurrence: 'daily',
  recurrenceDays: [false, true, true, true, true, true, false],
  recurrenceInterval: 7,
  onceDate: '',
  time: '',
  room: '',
  points: 2,
};

export const itemDraft = signal<ItemDraft>({ ...DEFAULT_DRAFT });

export function resetItemDraft(): void {
  itemDraft.value = { ...DEFAULT_DRAFT, recurrenceDays: [...DEFAULT_DRAFT.recurrenceDays] };
}

/** Window in days for the Fairness tab — 7, 30, or 90 are the
 * supported values; the handler validates. */
export const fairnessWindowDays = signal<number>(30);
