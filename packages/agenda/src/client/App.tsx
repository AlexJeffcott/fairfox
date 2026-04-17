/** @jsxImportSource preact */
// Agenda sub-app — three views: Today, Items, Fairness.
// All state from the $meshState agenda document. Actions dispatch through
// the global delegator via data-action attributes.

import { ActionInput, Badge, Button, Layout, Tabs } from '@fairfox/polly/ui';
import { useSignal } from '@preact/signals';
import type { AgendaItem, Completion } from '#src/client/state.ts';
import { agenda } from '#src/client/state.ts';

type ViewId = 'today' | 'items' | 'fairness';

const TAB_LIST = [
  { id: 'today', label: 'Today' },
  { id: 'items', label: 'Items' },
  { id: 'fairness', label: 'Fairness' },
];

const PEOPLE = ['Alex', 'Elisa', 'Leo'];

function isDueToday(item: AgendaItem, completions: Completion[]): boolean {
  if (!item.active || item.kind === 'event') {
    return item.active;
  }
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const doneCompletions = completions
    .filter((c) => c.itemId === item.id && c.kind === 'done')
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const lastDone = doneCompletions[0];

  if (item.recurrence === 'once') {
    return !lastDone;
  }
  if (item.recurrence === 'daily') {
    return !lastDone || lastDone.completedAt.slice(0, 10) !== todayStr;
  }
  if (item.recurrence === 'weekdays') {
    const dayIndex = now.getDay();
    const days = item.recurrenceDays ?? [false, true, true, true, true, true, false];
    if (!days[dayIndex]) {
      return false;
    }
    return !lastDone || lastDone.completedAt.slice(0, 10) !== todayStr;
  }
  if (item.recurrence === 'interval' && item.recurrenceInterval) {
    if (!lastDone) {
      return true;
    }
    const lastDate = new Date(lastDone.completedAt);
    const diffDays = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= item.recurrenceInterval;
  }
  return false;
}

function TodayView() {
  const items = agenda.value.items.filter((i) => isDueToday(i, agenda.value.completions));
  const events = items.filter((i) => i.kind === 'event');
  const chores = items.filter((i) => i.kind === 'chore');

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      {events.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Events</h3>
          {events.map((e) => (
            <Layout key={e.id} columns="auto 1fr" gap="var(--polly-space-sm)" alignItems="center">
              {e.time !== undefined && <Badge variant="info">{e.time}</Badge>}
              <span>{e.name}</span>
            </Layout>
          ))}
        </Layout>
      )}
      {chores.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Chores</h3>
          {chores.map((c) => (
            <Layout
              key={c.id}
              columns="1fr auto auto auto"
              gap="var(--polly-space-xs)"
              alignItems="center"
            >
              <span>{c.name}</span>
              {PEOPLE.map((person) => (
                <Button
                  key={`${c.id}-${person}`}
                  label={person}
                  size="small"
                  tier="secondary"
                  data-action="chore.done"
                  data-action-item-id={c.id}
                  data-action-person={person}
                />
              ))}
            </Layout>
          ))}
        </Layout>
      )}
      {items.length === 0 && <p>Nothing due today.</p>}
    </Layout>
  );
}

function ItemsView() {
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <ActionInput
        value=""
        variant="single"
        action="item.create"
        saveOn="enter"
        placeholder="Add a chore..."
      />
      {agenda.value.items.map((item) => (
        <Layout
          key={item.id}
          columns="auto 1fr auto"
          gap="var(--polly-space-sm)"
          alignItems="center"
        >
          <Badge variant={item.kind === 'event' ? 'info' : 'default'}>{item.kind}</Badge>
          <span>{item.name}</span>
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
    </Layout>
  );
}

function FairnessView() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentCompletions = agenda.value.completions.filter(
    (c) => c.kind === 'done' && c.completedAt >= thirtyDaysAgo
  );
  const totals = new Map<string, number>();
  for (const c of recentCompletions) {
    const item = agenda.value.items.find((i) => i.id === c.itemId);
    const points = item?.points ?? 1;
    totals.set(c.person, (totals.get(c.person) ?? 0) + points);
  }
  const totalPoints = Array.from(totals.values()).reduce((a, b) => a + b, 0);

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <h3>Last 30 days</h3>
      {PEOPLE.map((person) => {
        const pts = totals.get(person) ?? 0;
        const pct = totalPoints > 0 ? Math.round((pts / totalPoints) * 100) : 0;
        return (
          <Layout
            key={person}
            columns="6rem 1fr auto"
            gap="var(--polly-space-sm)"
            alignItems="center"
          >
            <strong>{person}</strong>
            <span>{pts} points</span>
            <Badge variant={pct >= 30 ? 'success' : 'warning'}>{pct}%</Badge>
          </Layout>
        );
      })}
    </Layout>
  );
}

export function App() {
  const activeTab = useSignal<ViewId>('today');

  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <h1>Agenda</h1>
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
