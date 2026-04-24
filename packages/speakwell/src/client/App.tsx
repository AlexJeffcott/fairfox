/** @jsxImportSource preact */
// Speakwell — a coaching UI for storytelling, elevator pitches, and
// summarising practice. Two views: Start (pick a format and language),
// History (review past sessions). Full voice I/O comes in a later
// iteration; the current UI is a text-first stepping stone.

import { ActionInput, Badge, Button, Layout, Tabs } from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import type { Format, Language } from '#src/client/state.ts';
import {
  activeTab,
  sessionsState,
  startFormat,
  startLanguage,
  startTopic,
} from '#src/client/state.ts';

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
  const format = startFormat.value;
  const language = startLanguage.value;
  const topic = startTopic.value;

  return (
    <Layout rows="auto" gap="var(--polly-space-lg)">
      <h2>New session</h2>
      <Layout rows="auto" gap="var(--polly-space-sm)">
        <strong>Format</strong>
        <Layout columns="auto auto auto" gap="var(--polly-space-sm)">
          {(['yarn', 'pitch', 'summary'] as const).map((f) => (
            <Button
              key={f}
              label={FORMAT_LABELS[f]}
              tier={format === f ? 'primary' : 'secondary'}
              size="small"
              data-action="speakwell.pick-format"
              data-action-format={f}
            />
          ))}
        </Layout>
      </Layout>
      <Layout rows="auto" gap="var(--polly-space-sm)">
        <strong>Language</strong>
        <Layout columns="auto auto auto" gap="var(--polly-space-sm)">
          {(['en-GB', 'it-IT', 'de-DE'] as const).map((l) => (
            <Button
              key={l}
              label={LANGUAGE_LABELS[l]}
              tier={language === l ? 'primary' : 'secondary'}
              size="small"
              data-action="speakwell.pick-language"
              data-action-language={l}
            />
          ))}
        </Layout>
      </Layout>
      <ActionInput
        value={topic}
        variant="single"
        action="speakwell.set-topic"
        saveOn="blur"
        placeholder="Topic or prompt (optional)"
      />
      <Button
        label="Begin"
        tier="primary"
        data-action="session.start"
        data-action-format={format}
        data-action-language={language}
        data-action-speaker="Alex"
        data-action-topic={topic}
      />
    </Layout>
  );
}

function HistoryView() {
  const sessions = [...sessionsState.value.sessions].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt)
  );

  if (sessions.length === 0) {
    return <p style={{ color: 'var(--polly-text-muted)' }}>No sessions yet.</p>;
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      {sessions.map((s) => (
        <Layout
          key={s.id}
          columns="auto 1fr auto auto"
          gap="var(--polly-space-sm)"
          alignItems="center"
        >
          <Badge variant="info">{FORMAT_LABELS[s.format]}</Badge>
          <Layout rows="auto" gap="0">
            <strong>{s.topic || 'Untitled'}</strong>
            <span style={{ fontSize: 'var(--polly-text-xs)', color: 'var(--polly-text-muted)' }}>
              {s.speaker} · {LANGUAGE_LABELS[s.language]} · {s.turns.length} turns
            </span>
          </Layout>
          {s.rating !== null && <Badge variant="success">{s.rating}/5</Badge>}
          <span style={{ fontSize: 'var(--polly-text-xs)', color: 'var(--polly-text-muted)' }}>
            {new Date(s.startedAt).toLocaleDateString()}
          </span>
        </Layout>
      ))}
    </Layout>
  );
}

export function App() {
  const current = activeTab.value;

  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <h1 style={{ margin: 0 }}>Speakwell</h1>
          <HubBack />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={current} action="speakwell.tab" />
      </Layout>
      <div>
        {current === 'start' && <StartView />}
        {current === 'history' && <HistoryView />}
      </div>
    </Layout>
  );
}
