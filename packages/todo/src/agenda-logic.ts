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

export const PEOPLE = ['Leo', 'Elisa', 'Alex'] as const;
export type Person = (typeof PEOPLE)[number];

export type ItemKind = 'task' | 'event';
export type Recurrence = 'once' | 'daily' | 'weekdays' | 'interval';
export type CompletionKind = 'done' | 'snooze_1d' | 'snooze_3d' | 'snooze_7d';

export type RecurrenceData =
  | { type: 'once'; date: string }
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }
  | { type: 'interval'; interval_days: number };

export interface AgendaItem {
  id: number;
  kind: ItemKind;
  name: string;
  room: Room | null;
  points: number;
  time_of_day: string | null;
  recurrence: Recurrence;
  recurrence_data: string;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Completion {
  id: number;
  item_id: number;
  done_by: Person;
  done_at: string;
  kind: CompletionKind;
}

export function isRoom(v: unknown): v is Room {
  return typeof v === 'string' && (ROOMS as readonly string[]).includes(v);
}

export function isPerson(v: unknown): v is Person {
  return typeof v === 'string' && (PEOPLE as readonly string[]).includes(v);
}

export function isItemKind(v: unknown): v is ItemKind {
  return v === 'task' || v === 'event';
}

export function isRecurrence(v: unknown): v is Recurrence {
  return v === 'once' || v === 'daily' || v === 'weekdays' || v === 'interval';
}

export function isCompletionKind(v: unknown): v is CompletionKind {
  return v === 'done' || v === 'snooze_1d' || v === 'snooze_3d' || v === 'snooze_7d';
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function snoozeIntervalDays(kind: CompletionKind): number {
  switch (kind) {
    case 'snooze_1d':
      return 1;
    case 'snooze_3d':
      return 3;
    case 'snooze_7d':
      return 7;
    case 'done':
      return 0;
  }
}

export function parseRecurrenceData(recurrence: Recurrence, raw: string): RecurrenceData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`recurrence_data is not valid JSON: ${errMsg(err)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error('recurrence_data must be a JSON object');
  }
  switch (recurrence) {
    case 'once': {
      const date = parsed.date;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('once recurrence requires a YYYY-MM-DD date field');
      }
      return { type: 'once', date };
    }
    case 'daily':
      return { type: 'daily' };
    case 'weekdays': {
      const days = parsed.days;
      if (!Array.isArray(days) || days.length === 0) {
        throw new Error('weekdays recurrence requires a non-empty days array');
      }
      const out: number[] = [];
      for (const d of days) {
        if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 7) {
          throw new Error('weekdays days must be integers 1-7 (1 = Mon, 7 = Sun)');
        }
        out.push(d);
      }
      return { type: 'weekdays', days: out };
    }
    case 'interval': {
      const interval = parsed.interval_days;
      if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1) {
        throw new Error('interval recurrence requires a positive integer interval_days');
      }
      return { type: 'interval', interval_days: interval };
    }
  }
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoWeekday(d: Date): number {
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

export function daysBetween(from: Date, to: Date): number {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((toMidnight - fromMidnight) / 86400000);
}

export function addDays(d: Date, days: number): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

export interface VisibilityResult {
  visible: boolean;
  daysOverdue: number;
}

export function shouldAppearToday(
  item: AgendaItem,
  rdata: RecurrenceData,
  lastCompletion: Completion | null,
  today: Date
): VisibilityResult {
  const todayIso = isoDate(today);

  switch (rdata.type) {
    case 'once': {
      if (lastCompletion?.kind === 'done') {
        return { visible: false, daysOverdue: 0 };
      }
      let effectiveDue = parseLocalDate(rdata.date);
      if (lastCompletion !== null) {
        const completedAt = new Date(lastCompletion.done_at);
        effectiveDue = addDays(completedAt, snoozeIntervalDays(lastCompletion.kind));
      }
      const overdue = daysBetween(effectiveDue, today);
      if (overdue < 0) {
        return { visible: false, daysOverdue: 0 };
      }
      return { visible: true, daysOverdue: overdue };
    }

    case 'daily':
    case 'weekdays': {
      if (rdata.type === 'weekdays' && !rdata.days.includes(isoWeekday(today))) {
        return { visible: false, daysOverdue: 0 };
      }
      if (lastCompletion !== null) {
        if (lastCompletion.kind === 'done') {
          const completedDay = isoDate(new Date(lastCompletion.done_at));
          if (completedDay === todayIso) {
            return { visible: false, daysOverdue: 0 };
          }
        } else {
          const completedAt = new Date(lastCompletion.done_at);
          const suppressedUntil = addDays(completedAt, snoozeIntervalDays(lastCompletion.kind));
          if (daysBetween(suppressedUntil, today) < 0) {
            return { visible: false, daysOverdue: 0 };
          }
        }
      }
      return { visible: true, daysOverdue: 0 };
    }

    case 'interval': {
      let referenceDate: Date;
      let referenceInterval: number;
      if (lastCompletion) {
        referenceDate = new Date(lastCompletion.done_at);
        referenceInterval =
          lastCompletion.kind === 'done'
            ? rdata.interval_days
            : snoozeIntervalDays(lastCompletion.kind);
      } else {
        referenceDate = new Date(item.created_at);
        referenceInterval = 0;
      }
      const dueDate = addDays(referenceDate, referenceInterval);
      const overdue = daysBetween(dueDate, today);
      if (overdue < 0) {
        return { visible: false, daysOverdue: 0 };
      }
      return { visible: true, daysOverdue: overdue };
    }
  }
}

function parseLocalDate(iso: string): Date {
  const parts = iso.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(y, m - 1, d);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
