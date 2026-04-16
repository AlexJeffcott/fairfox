/** @jsxImportSource preact */
// Speakwell — a coaching UI for storytelling, elevator pitches, and
// summarising practice. Two views: Start (pick a format and language),
// History (review past sessions). Full voice I/O comes in a later
// iteration; the current UI is a text-first stepping stone.

import { PairingBanner } from '@fairfox/shared/pairing-banner';
import { Badge, Button, Input, Layout, Tabs } from '@fairfox/ui';
import { useSignal } from '@preact/signals';
import type { Format, Language } from '#src/client/state.ts';
import { sessionsState } from '#src/client/state.ts';

type ViewId = 'start' | 'history';

const TAB_LIST = [
  { id: 'start', label: 'Start' },
  { id: 'history', label: 'History' },
];

const FORMAT_LABELS: Record<Format, string> = {
  yarn: 'Spin a yarn',
  pitch: 'Elevator pitch',
  summary: 'Summary',
};

const LANGUAGE_LABELS: Record<Language, string> = {
  'en-GB': 'English (UK)',
  'it-IT': 'Italiano',
  'de-DE': 'Deutsch',
};

function StartView() {
  const format = useSignal<Format>('yarn');
  const language = useSignal<Language>('en-GB');
  const topic = useSignal('');

  return (
    <Layout rows="auto" gap="var(--space-lg)">
      <h2>New session</h2>
      <Layout rows="auto" gap="var(--space-sm)">
        <strong>Format</strong>
        <Layout columns="auto auto auto" gap="var(--space-sm)">
          {(['yarn', 'pitch', 'summary'] as const).map((f) => (
            <Button
              key={f}
              label={FORMAT_LABELS[f]}
              tier={format.value === f ? 'primary' : 'secondary'}
              size="small"
              data-action="speakwell.pick-format"
              data-action-format={f}
            />
          ))}
        </Layout>
      </Layout>
      <Layout rows="auto" gap="var(--space-sm)">
        <strong>Language</strong>
        <Layout columns="auto auto auto" gap="var(--space-sm)">
          {(['en-GB', 'it-IT', 'de-DE'] as const).map((l) => (
            <Button
              key={l}
              label={LANGUAGE_LABELS[l]}
              tier={language.value === l ? 'primary' : 'secondary'}
              size="small"
              data-action="speakwell.pick-language"
              data-action-language={l}
            />
          ))}
        </Layout>
      </Layout>
      <Input
        value={topic.value}
        variant="single"
        action="speakwell.set-topic"
        saveOn="blur"
        placeholder="Topic or prompt (optional)"
        markdown={false}
      />
      <Button
        label="Begin"
        tier="primary"
        data-action="session.start"
        data-action-format={format.value}
        data-action-language={language.value}
        data-action-speaker="Alex"
        data-action-topic={topic.value}
      />
    </Layout>
  );
}

function HistoryView() {
  const sessions = [...sessionsState.value.sessions].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  );

  if (sessions.length === 0) {
    return <p style={{ color: 'var(--txt-secondary)' }}>No sessions yet.</p>;
  }

  return (
    <Layout rows="auto" gap="var(--space-md)">
      {sessions.map((s) => (
        <Layout key={s.id} columns="auto 1fr auto auto" gap="var(--space-sm)" align="center">
          <Badge variant="info">{FORMAT_LABELS[s.format]}</Badge>
          <Layout rows="auto" gap="0">
            <strong>{s.topic || 'Untitled'}</strong>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--txt-tertiary)' }}>
              {s.speaker} · {LANGUAGE_LABELS[s.language]} · {s.turns.length} turns
            </span>
          </Layout>
          {s.rating !== null && <Badge variant="success">{s.rating}/5</Badge>}
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--txt-secondary)' }}>
            {new Date(s.startedAt).toLocaleDateString()}
          </span>
        </Layout>
      ))}
    </Layout>
  );
}

export function App() {
  const activeTab = useSignal<ViewId>('start');

  return (
    <Layout rows="auto auto 1fr" gap="var(--space-lg)" padding="var(--space-lg)">
      <PairingBanner />
      <Layout rows="auto" gap="var(--space-md)">
        <h1>Speakwell</h1>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="speakwell.tab" />
      </Layout>
      <div>
        {activeTab.value === 'start' && <StartView />}
        {activeTab.value === 'history' && <HistoryView />}
      </div>
    </Layout>
  );
}
