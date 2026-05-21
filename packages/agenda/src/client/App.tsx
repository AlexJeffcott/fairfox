/** @jsxImportSource preact */
// Agenda sub-app — three views: Today, Items, Fairness.
// All state from the $meshState agenda document. Actions dispatch through
// the global delegator via data-action attributes.

import {
  ActionInput,
  ActionSelect,
  Badge,
  Button,
  Layout,
  Surface,
  Tabs,
  Text,
} from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { effect, signal } from '@preact/signals';
import type { AgendaItem, Completion, RecurrenceType } from '#src/client/state.ts';
import { activeTab, agenda, fairnessWindowDays, itemDraft, ROOMS } from '#src/client/state.ts';

const TAB_LIST = [
  { id: 'today', label: 'Today' },
  { id: 'items', label: 'Items' },
  { id: 'fairness', label: 'Fairness' },
];

const PEOPLE = ['Alex', 'Elisa', 'Leo'] as const;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface DueInfo {
  due: boolean;
  daysOverdue: number;
}

function lastDoneCompletion(itemId: string, completions: Completion[]): Completion | undefined {
  const done = completions
    .filter((c) => c.itemId === itemId && c.kind === 'done')
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return done[0];
}

function lastSnoozeCompletion(itemId: string, completions: Completion[]): Completion | undefined {
  const snoozes = completions
    .filter((c) => c.itemId === itemId && c.kind !== 'done')
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return snoozes[0];
}

function snoozeDays(kind: Completion['kind']): number {
  if (kind === 'snooze-1d') {
    return 1;
  }
  if (kind === 'snooze-3d') {
    return 3;
  }
  if (kind === 'snooze-7d') {
    return 7;
  }
  return 0;
}

function snoozeActiveUntil(
  item: AgendaItem,
  completions: Completion[]
): { active: boolean; expiresAt: Date | null } {
  const last = lastSnoozeCompletion(item.id, completions);
  if (!last) {
    return { active: false, expiresAt: null };
  }
  const done = lastDoneCompletion(item.id, completions);
  if (done && done.completedAt > last.completedAt) {
    return { active: false, expiresAt: null };
  }
  const expiresAt = new Date(last.completedAt);
  expiresAt.setDate(expiresAt.getDate() + snoozeDays(last.kind));
  return { active: expiresAt.getTime() > Date.now(), expiresAt };
}

function dueToday(item: AgendaItem, completions: Completion[]): DueInfo {
  if (!item.active) {
    return { due: false, daysOverdue: 0 };
  }
  if (item.kind === 'event') {
    return { due: true, daysOverdue: 0 };
  }
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const lastDone = lastDoneCompletion(item.id, completions);
  const snooze = snoozeActiveUntil(item, completions);
  if (snooze.active) {
    return { due: false, daysOverdue: 0 };
  }
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  if (item.recurrence === 'once') {
    if (lastDone) {
      return { due: false, daysOverdue: 0 };
    }
    const targetStr = item.onceDate ?? todayStr;
    const target = new Date(`${targetStr}T00:00:00`);
    const diff = Math.floor((now.getTime() - target.getTime()) / MS_PER_DAY);
    return { due: diff >= 0, daysOverdue: Math.max(0, diff) };
  }

  if (item.recurrence === 'daily') {
    if (lastDone && lastDone.completedAt.slice(0, 10) === todayStr) {
      return { due: false, daysOverdue: 0 };
    }
    if (!lastDone) {
      return { due: true, daysOverdue: 0 };
    }
    const diff = Math.floor(
      (now.getTime() - new Date(lastDone.completedAt).getTime()) / MS_PER_DAY
    );
    return { due: true, daysOverdue: Math.max(0, diff - 1) };
  }

  if (item.recurrence === 'weekdays') {
    const days = item.recurrenceDays ?? [false, true, true, true, true, true, false];
    if (!days[now.getDay()]) {
      return { due: false, daysOverdue: 0 };
    }
    if (lastDone && lastDone.completedAt.slice(0, 10) === todayStr) {
      return { due: false, daysOverdue: 0 };
    }
    return { due: true, daysOverdue: 0 };
  }

  if (item.recurrence === 'interval' && item.recurrenceInterval) {
    if (!lastDone) {
      return { due: true, daysOverdue: 0 };
    }
    const diff = Math.floor(
      (now.getTime() - new Date(lastDone.completedAt).getTime()) / MS_PER_DAY
    );
    const overdue = diff - item.recurrenceInterval;
    return { due: overdue >= 0, daysOverdue: Math.max(0, overdue) };
  }
  return { due: false, daysOverdue: 0 };
}

function overdueBadgeVariant(daysOverdue: number): 'default' | 'info' | 'warning' | 'danger' {
  if (daysOverdue === 0) {
    return 'info';
  }
  if (daysOverdue <= 2) {
    return 'default';
  }
  if (daysOverdue <= 7) {
    return 'warning';
  }
  return 'danger';
}

function overdueLabel(daysOverdue: number): string {
  if (daysOverdue === 0) {
    return 'today';
  }
  if (daysOverdue === 1) {
    return '1 day overdue';
  }
  return `${daysOverdue} days overdue`;
}

function TodayView() {
  const now = new Date();
  const completions = agenda.value.completions;
  const annotated = agenda.value.items
    .map((item) => ({ item, due: dueToday(item, completions) }))
    .filter((row) => row.due.due);

  const events = annotated
    .filter((row) => row.item.kind === 'event')
    .sort((a, b) => (a.item.time ?? '').localeCompare(b.item.time ?? ''));

  const chores = annotated
    .filter((row) => row.item.kind === 'chore')
    .sort((a, b) => b.due.daysOverdue - a.due.daysOverdue);

  if (annotated.length === 0) {
    return (
      <Text as="p" tone="muted">
        Nothing due today ({now.toISOString().slice(0, 10)}).
      </Text>
    );
  }

  return (
    <Layout rows="auto auto" gap="var(--polly-space-md)">
      {events.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <Text as="h3" size="lg" weight="bold">
            Events
          </Text>
          {events.map(({ item }) => (
            <Layout
              key={item.id}
              columns="auto 1fr"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              {item.time && <Badge variant="info">{item.time}</Badge>}
              <span data-polly-truncate={true}>{item.name}</span>
            </Layout>
          ))}
        </Layout>
      )}
      {chores.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <Text as="h3" size="lg" weight="bold">
            Chores
          </Text>
          {chores.map(({ item, due }) => (
            <ChoreRow key={item.id} item={item} daysOverdue={due.daysOverdue} />
          ))}
        </Layout>
      )}
    </Layout>
  );
}

function ChoreRow({ item, daysOverdue }: { item: AgendaItem; daysOverdue: number }) {
  return (
    <Layout rows="auto auto" gap="var(--polly-space-xs)" padding="var(--polly-space-sm) 0">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <span data-polly-truncate={true}>
          <strong>{item.name}</strong>
          {item.room && (
            <Text size="sm" tone="muted">
              {' '}
              {item.room}
            </Text>
          )}
        </span>
        <Badge variant={overdueBadgeVariant(daysOverdue)}>{overdueLabel(daysOverdue)}</Badge>
      </Layout>
      <Layout
        columns="repeat(auto-fill, minmax(3rem, 1fr))"
        gap="var(--polly-space-xs)"
        alignItems="center"
      >
        {PEOPLE.map((person) => (
          <Button
            key={`${item.id}-done-${person}`}
            label={person}
            size="small"
            tier="primary"
            data-action="chore.done"
            data-action-item-id={item.id}
            data-action-person={person}
          />
        ))}
        <Button
          label="+1d"
          size="small"
          tier="tertiary"
          data-action="chore.snooze"
          data-action-item-id={item.id}
          data-action-person="Alex"
          data-action-days="1"
        />
        <Button
          label="+3d"
          size="small"
          tier="tertiary"
          data-action="chore.snooze"
          data-action-item-id={item.id}
          data-action-person="Alex"
          data-action-days="3"
        />
        <Button
          label="+7d"
          size="small"
          tier="tertiary"
          data-action="chore.snooze"
          data-action-item-id={item.id}
          data-action-person="Alex"
          data-action-days="7"
        />
      </Layout>
    </Layout>
  );
}

const RECURRENCE_OPTIONS: RecurrenceType[] = ['once', 'daily', 'weekdays', 'interval'];

function CreateItemForm() {
  const draft = itemDraft.value;
  return (
    <Layout rows="auto auto auto auto" gap="var(--polly-space-sm)" padding="var(--polly-space-md)">
      <Layout rows="auto auto" gap="var(--polly-space-sm)">
        <Layout columns="1fr 1fr" gap="var(--polly-space-xs)" alignItems="center">
          <Button
            label="Chore"
            size="small"
            tier={draft.kind === 'chore' ? 'primary' : 'tertiary'}
            data-action="draft.kind"
            data-action-kind="chore"
          />
          <Button
            label="Event"
            size="small"
            tier={draft.kind === 'event' ? 'primary' : 'tertiary'}
            data-action="draft.kind"
            data-action-kind="event"
          />
        </Layout>
        <ActionInput
          value={draft.name}
          variant="single"
          action="draft.name"
          saveOn="blur"
          placeholder={draft.kind === 'event' ? 'Event name' : 'Chore name'}
        />
      </Layout>
      <Layout
        columns="repeat(auto-fill, minmax(4.75rem, 1fr))"
        gap="var(--polly-space-xs)"
        alignItems="center"
      >
        {RECURRENCE_OPTIONS.map((r) => (
          <Button
            key={r}
            label={r}
            size="small"
            tier={draft.recurrence === r ? 'primary' : 'tertiary'}
            data-action="draft.recurrence"
            data-action-recurrence={r}
          />
        ))}
      </Layout>
      {draft.recurrence === 'weekdays' && (
        <Layout columns="repeat(auto-fill, minmax(2.75rem, 1fr))" gap="var(--polly-space-xs)">
          {WEEKDAY_LABELS.map((label, i) => (
            <Button
              key={label}
              label={label}
              size="small"
              tier={draft.recurrenceDays[i] ? 'primary' : 'tertiary'}
              data-action="draft.weekday"
              data-action-index={String(i)}
            />
          ))}
        </Layout>
      )}
      {draft.recurrence === 'interval' && (
        <Layout columns="auto 1fr" gap="var(--polly-space-xs)" alignItems="center">
          <Text size="sm">Every</Text>
          <ActionInput
            value={String(draft.recurrenceInterval)}
            variant="single"
            action="draft.interval"
            saveOn="blur"
            placeholder="days"
            ariaLabel="Interval in days"
          />
        </Layout>
      )}
      {draft.recurrence === 'once' && (
        <ActionInput
          value={draft.onceDate}
          variant="single"
          action="draft.once-date"
          saveOn="blur"
          placeholder="YYYY-MM-DD"
          ariaLabel="Date"
        />
      )}
      <Layout
        columns="1fr 1fr 1fr auto"
        gap="var(--polly-space-xs)"
        alignItems="center"
        stackOnMobile={true}
      >
        <ActionInput
          value={draft.time}
          variant="single"
          action="draft.time"
          saveOn="blur"
          placeholder={draft.kind === 'event' ? 'HH:MM (required)' : 'HH:MM (optional)'}
          ariaLabel="Time of day"
        />
        <ActionInput
          value={String(draft.points)}
          variant="single"
          action="draft.points"
          saveOn="blur"
          placeholder="points (1–10)"
          ariaLabel="Points"
        />
        <ActionSelect
          value={draft.room ?? ''}
          action="draft.room"
          placeholder="(no room)"
          options={[
            { value: '', label: '(no room)' },
            ...ROOMS.map((room) => ({ value: room, label: room })),
          ]}
        />
        <Button label="Add" size="small" tier="primary" data-action="item.create-from-draft" />
      </Layout>
    </Layout>
  );
}

function ItemsView() {
  const showArchivedSignal = showArchived;
  const items = agenda.value.items.filter((i) => (showArchivedSignal.value ? true : i.active));
  return (
    <Layout rows="auto auto" gap="var(--polly-space-md)">
      <CreateItemForm />
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <Text as="h3" size="lg" weight="bold">
          {showArchivedSignal.value ? 'All items' : 'Active items'}
        </Text>
        <Button
          label={showArchivedSignal.value ? 'Hide archived' : 'Show archived'}
          size="small"
          tier="tertiary"
          data-action="items.toggle-archived"
        />
      </Layout>
      <Layout rows="auto" gap="var(--polly-space-xs)">
        {items.map((item) => (
          <Layout
            key={item.id}
            columns="auto minmax(0, 1fr) auto auto"
            gap="var(--polly-space-sm)"
            alignItems="center"
          >
            <Badge variant={item.kind === 'event' ? 'info' : 'default'}>{item.kind}</Badge>
            <Layout rows="auto auto">
              <strong>{item.name}</strong>
              <Text as="div" size="sm" tone="muted">
                {describeRecurrence(item)}
                {item.room && ` · ${item.room}`}
                {item.time && ` · ${item.time}`}
                {` · ${item.points} pt`}
              </Text>
            </Layout>
            <Button
              label={item.active ? 'Archive' : 'Restore'}
              size="small"
              tier="tertiary"
              data-action="item.toggle-active"
              data-action-id={item.id}
            />
            <Button
              label="Delete"
              size="small"
              tier="tertiary"
              color="danger"
              data-action="item.delete"
              data-action-id={item.id}
            />
          </Layout>
        ))}
        {items.length === 0 && (
          <Text as="p" tone="muted">
            No items. Add one above.
          </Text>
        )}
      </Layout>
    </Layout>
  );
}

const showArchived = signal<boolean>(false);

export const agendaViewSignals = { showArchived };

function describeRecurrence(item: AgendaItem): string {
  if (item.recurrence === 'once') {
    return item.onceDate ? `once on ${item.onceDate}` : 'once';
  }
  if (item.recurrence === 'daily') {
    return 'daily';
  }
  if (item.recurrence === 'weekdays') {
    const days = item.recurrenceDays ?? [];
    const active = WEEKDAY_LABELS.filter((_, i) => days[i]);
    return active.length === 0 ? 'no weekdays' : active.join(' ');
  }
  if (item.recurrence === 'interval' && item.recurrenceInterval) {
    return `every ${item.recurrenceInterval}d`;
  }
  return item.recurrence;
}

const FAIRNESS_WINDOWS = [7, 30, 90] as const;

function FairnessView() {
  const days = fairnessWindowDays.value;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const recent = agenda.value.completions.filter(
    (c) => c.kind === 'done' && c.completedAt >= cutoff
  );
  const totals = new Map<string, { points: number; count: number }>();
  for (const c of recent) {
    const item = agenda.value.items.find((i) => i.id === c.itemId);
    const points = item?.points ?? 1;
    const prev = totals.get(c.person) ?? { points: 0, count: 0 };
    totals.set(c.person, { points: prev.points + points, count: prev.count + 1 });
  }
  const totalPoints = Array.from(totals.values()).reduce((a, b) => a + b.points, 0);

  return (
    <Layout rows="auto auto auto" gap="var(--polly-space-md)">
      <Layout columns="auto auto auto" gap="var(--polly-space-xs)">
        {FAIRNESS_WINDOWS.map((w) => (
          <Button
            key={w}
            label={`Last ${w}d`}
            size="small"
            tier={days === w ? 'primary' : 'tertiary'}
            data-action="fairness.window"
            data-action-days={String(w)}
          />
        ))}
      </Layout>
      <Text as="p" tone="muted">
        {recent.length} completions · {totalPoints} points
      </Text>
      <Layout rows="auto" gap="var(--polly-space-xs)">
        {PEOPLE.map((person) => {
          const entry = totals.get(person) ?? { points: 0, count: 0 };
          const pct = totalPoints > 0 ? Math.round((entry.points / totalPoints) * 100) : 0;
          return (
            <Layout
              key={person}
              columns="6rem minmax(0, 1fr) auto auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              <strong>{person}</strong>
              <span>
                {entry.count} done · {entry.points} pt
              </span>
              <Badge variant={pct >= 30 ? 'success' : 'warning'}>{pct}%</Badge>
              <Surface width="4rem" height="0.4rem" background="sunken" radius="full">
                <Surface
                  width={`${pct}%`}
                  height="0.4rem"
                  background="var(--polly-accent)"
                  radius="full"
                />
              </Surface>
            </Layout>
          );
        })}
      </Layout>
    </Layout>
  );
}

let agendaEffectsInstalled = false;

/** Publish the agenda view's page-context. */
export function installAgendaEffects(): void {
  if (agendaEffectsInstalled) {
    return;
  }
  agendaEffectsInstalled = true;
  effect(() => {
    const tab = activeTab.value;
    if (tab === 'today') {
      setPageContext({ kind: 'agenda-today', label: "Today's agenda" });
      return;
    }
    if (tab === 'items') {
      const count = agenda.value.items.filter((i) => i.active).length;
      setPageContext({
        kind: 'hub',
        label: `Agenda items (${count} active)`,
      });
      return;
    }
    if (tab === 'fairness') {
      setPageContext({
        kind: 'hub',
        label: `Agenda fairness · ${fairnessWindowDays.value}d`,
      });
      return;
    }
  });
}

export function App() {
  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <Text as="h1" size="xl" weight="bold">
            Agenda
          </Text>
          <HubBack />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="agenda.tab" />
      </Layout>
      <div>
        {activeTab.value === 'today' && <TodayView />}
        {activeTab.value === 'items' && <ItemsView />}
        {activeTab.value === 'fairness' && <FairnessView />}
      </div>
    </Layout>
  );
}
