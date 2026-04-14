import { describe, expect, test } from 'bun:test';
import {
  type AgendaItem,
  type Completion,
  daysBetween,
  isoDate,
  isoWeekday,
  parseRecurrenceData,
  shouldAppearToday,
  snoozeIntervalDays,
} from '../src/agenda-logic';

function baseItem(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: 1,
    kind: 'task',
    name: 'test',
    room: null,
    points: 1,
    time_of_day: null,
    recurrence: 'interval',
    recurrence_data: '{"interval_days":7}',
    notes: '',
    archived_at: null,
    created_at: '2026-04-01 00:00:00',
    updated_at: '2026-04-01 00:00:00',
    ...overrides,
  };
}

function completion(overrides: Partial<Completion> = {}): Completion {
  return {
    id: 1,
    item_id: 1,
    done_by: 'Alex',
    done_at: '2026-04-10 09:00:00',
    kind: 'done',
    ...overrides,
  };
}

describe('snoozeIntervalDays', () => {
  test('returns the right days for each kind', () => {
    expect(snoozeIntervalDays('done')).toBe(0);
    expect(snoozeIntervalDays('snooze_1d')).toBe(1);
    expect(snoozeIntervalDays('snooze_3d')).toBe(3);
    expect(snoozeIntervalDays('snooze_7d')).toBe(7);
  });
});

describe('isoDate / isoWeekday / daysBetween', () => {
  test('isoDate formats a local-calendar date', () => {
    expect(isoDate(new Date(2026, 3, 14))).toBe('2026-04-14');
  });

  test('isoWeekday maps Sunday to 7', () => {
    expect(isoWeekday(new Date(2026, 3, 12))).toBe(7);
    expect(isoWeekday(new Date(2026, 3, 13))).toBe(1);
    expect(isoWeekday(new Date(2026, 3, 18))).toBe(6);
  });

  test('daysBetween counts whole calendar days', () => {
    expect(daysBetween(new Date(2026, 3, 10), new Date(2026, 3, 14))).toBe(4);
    expect(daysBetween(new Date(2026, 3, 14), new Date(2026, 3, 14))).toBe(0);
    expect(daysBetween(new Date(2026, 3, 15), new Date(2026, 3, 14))).toBe(-1);
  });
});

describe('parseRecurrenceData', () => {
  test('once requires a YYYY-MM-DD date', () => {
    expect(parseRecurrenceData('once', '{"date":"2026-04-17"}')).toEqual({
      type: 'once',
      date: '2026-04-17',
    });
    expect(() => parseRecurrenceData('once', '{}')).toThrow();
    expect(() => parseRecurrenceData('once', '{"date":"April 17"}')).toThrow();
  });

  test('daily ignores extra fields', () => {
    expect(parseRecurrenceData('daily', '{}')).toEqual({ type: 'daily' });
  });

  test('weekdays requires integer days 1-7', () => {
    expect(parseRecurrenceData('weekdays', '{"days":[1,3,5]}')).toEqual({
      type: 'weekdays',
      days: [1, 3, 5],
    });
    expect(() => parseRecurrenceData('weekdays', '{"days":[]}')).toThrow();
    expect(() => parseRecurrenceData('weekdays', '{"days":[0]}')).toThrow();
    expect(() => parseRecurrenceData('weekdays', '{"days":[8]}')).toThrow();
    expect(() => parseRecurrenceData('weekdays', '{"days":[1.5]}')).toThrow();
  });

  test('interval requires positive integer interval_days', () => {
    expect(parseRecurrenceData('interval', '{"interval_days":21}')).toEqual({
      type: 'interval',
      interval_days: 21,
    });
    expect(() => parseRecurrenceData('interval', '{"interval_days":0}')).toThrow();
    expect(() => parseRecurrenceData('interval', '{"interval_days":-1}')).toThrow();
  });

  test('rejects malformed JSON', () => {
    expect(() => parseRecurrenceData('daily', 'not json')).toThrow();
  });
});

describe('shouldAppearToday — once', () => {
  const today = new Date(2026, 3, 14);

  test('not yet due', () => {
    const item = baseItem({ recurrence: 'once', recurrence_data: '{"date":"2026-04-17"}' });
    const r = shouldAppearToday(item, { type: 'once', date: '2026-04-17' }, null, today);
    expect(r.visible).toBe(false);
  });

  test('due today', () => {
    const item = baseItem({ recurrence: 'once', recurrence_data: '{"date":"2026-04-14"}' });
    const r = shouldAppearToday(item, { type: 'once', date: '2026-04-14' }, null, today);
    expect(r).toEqual({ visible: true, daysOverdue: 0 });
  });

  test('overdue by 4 days', () => {
    const item = baseItem({ recurrence: 'once', recurrence_data: '{"date":"2026-04-10"}' });
    const r = shouldAppearToday(item, { type: 'once', date: '2026-04-10' }, null, today);
    expect(r).toEqual({ visible: true, daysOverdue: 4 });
  });

  test('hidden after done', () => {
    const item = baseItem({ recurrence: 'once', recurrence_data: '{"date":"2026-04-14"}' });
    const r = shouldAppearToday(
      item,
      { type: 'once', date: '2026-04-14' },
      completion({ kind: 'done', done_at: '2026-04-14 08:00:00' }),
      today
    );
    expect(r.visible).toBe(false);
  });

  test('snooze 3d pushes the due date forward', () => {
    const item = baseItem({ recurrence: 'once', recurrence_data: '{"date":"2026-04-12"}' });
    const r = shouldAppearToday(
      item,
      { type: 'once', date: '2026-04-12' },
      completion({ kind: 'snooze_3d', done_at: '2026-04-12 09:00:00' }),
      today
    );
    expect(r.visible).toBe(false);
  });
});

describe('shouldAppearToday — daily / weekdays', () => {
  const monday = new Date(2026, 3, 13);
  const tuesday = new Date(2026, 3, 14);

  test('daily, never completed → visible', () => {
    const item = baseItem({ recurrence: 'daily', recurrence_data: '{}' });
    const r = shouldAppearToday(item, { type: 'daily' }, null, tuesday);
    expect(r).toEqual({ visible: true, daysOverdue: 0 });
  });

  test('daily, done earlier today → hidden', () => {
    const item = baseItem({ recurrence: 'daily', recurrence_data: '{}' });
    const r = shouldAppearToday(
      item,
      { type: 'daily' },
      completion({ kind: 'done', done_at: '2026-04-14 07:30:00' }),
      tuesday
    );
    expect(r.visible).toBe(false);
  });

  test('daily, done yesterday → visible again', () => {
    const item = baseItem({ recurrence: 'daily', recurrence_data: '{}' });
    const r = shouldAppearToday(
      item,
      { type: 'daily' },
      completion({ kind: 'done', done_at: '2026-04-13 07:30:00' }),
      tuesday
    );
    expect(r.visible).toBe(true);
  });

  test('weekdays Mon/Wed/Fri, today is Tuesday → hidden', () => {
    const item = baseItem({ recurrence: 'weekdays', recurrence_data: '{"days":[1,3,5]}' });
    const r = shouldAppearToday(item, { type: 'weekdays', days: [1, 3, 5] }, null, tuesday);
    expect(r.visible).toBe(false);
  });

  test('weekdays Mon/Wed/Fri, today is Monday → visible', () => {
    const item = baseItem({ recurrence: 'weekdays', recurrence_data: '{"days":[1,3,5]}' });
    const r = shouldAppearToday(item, { type: 'weekdays', days: [1, 3, 5] }, null, monday);
    expect(r.visible).toBe(true);
  });

  test('daily, snoozed today for 3d → hidden until Friday', () => {
    const item = baseItem({ recurrence: 'daily', recurrence_data: '{}' });
    const r = shouldAppearToday(
      item,
      { type: 'daily' },
      completion({ kind: 'snooze_3d', done_at: '2026-04-14 09:00:00' }),
      tuesday
    );
    expect(r.visible).toBe(false);
  });

  test('daily, snoozed yesterday for 1d → visible today (snooze interval elapsed)', () => {
    const item = baseItem({ recurrence: 'daily', recurrence_data: '{}' });
    const r = shouldAppearToday(
      item,
      { type: 'daily' },
      completion({ kind: 'snooze_1d', done_at: '2026-04-13 09:00:00' }),
      tuesday
    );
    expect(r.visible).toBe(true);
  });
});

describe('shouldAppearToday — interval', () => {
  const today = new Date(2026, 3, 14);

  test('never completed → due now (overdue from creation)', () => {
    const item = baseItem({
      recurrence: 'interval',
      recurrence_data: '{"interval_days":7}',
      created_at: '2026-04-10 00:00:00',
    });
    const r = shouldAppearToday(item, { type: 'interval', interval_days: 7 }, null, today);
    expect(r.visible).toBe(true);
    expect(r.daysOverdue).toBeGreaterThanOrEqual(0);
  });

  test('done 5 days ago, interval 7 → not yet due', () => {
    const item = baseItem({ recurrence: 'interval', recurrence_data: '{"interval_days":7}' });
    const r = shouldAppearToday(
      item,
      { type: 'interval', interval_days: 7 },
      completion({ kind: 'done', done_at: '2026-04-09 09:00:00' }),
      today
    );
    expect(r.visible).toBe(false);
  });

  test('done 10 days ago, interval 7 → 3 days overdue', () => {
    const item = baseItem({ recurrence: 'interval', recurrence_data: '{"interval_days":7}' });
    const r = shouldAppearToday(
      item,
      { type: 'interval', interval_days: 7 },
      completion({ kind: 'done', done_at: '2026-04-04 09:00:00' }),
      today
    );
    expect(r).toEqual({ visible: true, daysOverdue: 3 });
  });

  test('snooze_1d on a 7d interval acts as a 1-day delay', () => {
    const item = baseItem({ recurrence: 'interval', recurrence_data: '{"interval_days":7}' });
    const r = shouldAppearToday(
      item,
      { type: 'interval', interval_days: 7 },
      completion({ kind: 'snooze_1d', done_at: '2026-04-13 09:00:00' }),
      today
    );
    expect(r).toEqual({ visible: true, daysOverdue: 0 });
  });
});
