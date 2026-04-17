/** @jsxImportSource preact */
// The Struggle — interactive reader UI.
// Two views: Story (current passage + choices) and Memory (litanies + places).

import { ActionInput, Button, Layout, Tabs } from '@fairfox/polly/ui';
import { renderMarkdown } from '@fairfox/polly/ui/markdown';
import { MeshControls } from '@fairfox/shared/mesh-controls';
import { useSignal } from '@preact/signals';
import type { Passage } from '#src/client/state.ts';
import { progressState, storyState } from '#src/client/state.ts';

type ViewId = 'story' | 'memory';

const TAB_LIST = [
  { id: 'story', label: 'Story' },
  { id: 'memory', label: 'Memory' },
];

function currentPassage(): Passage | undefined {
  const progress = progressState.value.progress;
  if (!progress) {
    return undefined;
  }
  for (const chapter of storyState.value.chapters) {
    const passage = chapter.passages.find((p) => p.id === progress.currentPassageId);
    if (passage) {
      return passage;
    }
  }
  return undefined;
}

function StoryView() {
  const progress = progressState.value.progress;
  const passage = currentPassage();

  if (!progress || !passage) {
    return (
      <Layout rows="auto" gap="var(--polly-space-md)">
        <p>No game in progress.</p>
        <Button label="Begin" tier="primary" data-action="game.init" />
      </Layout>
    );
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <h2>{passage.title}</h2>
      <ActionInput
        value={passage.content.body}
        variant="multi"
        action="noop"
        disabled={true}
        renderView={renderMarkdown}
      />
      {passage.content.preamble && (
        <p style={{ fontStyle: 'italic', color: 'var(--polly-text-muted)' }}>
          {passage.content.preamble}
        </p>
      )}
      {passage.isDeath && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <p style={{ color: 'var(--polly-danger)' }}>You have reached a dead end.</p>
          <Button label="Start over" tier="secondary" color="danger" data-action="game.reset" />
        </Layout>
      )}
      {!passage.isDeath && passage.choices.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          {passage.choices.map((choice) => (
            <Button
              key={choice.id}
              label={choice.label}
              tier={choice.type === 'inspect' ? 'tertiary' : 'secondary'}
              data-action={choice.type === 'inspect' ? 'game.inspect' : 'game.navigate'}
              data-action-choice-id={choice.id}
            />
          ))}
        </Layout>
      )}
    </Layout>
  );
}

function MemoryView() {
  const progress = progressState.value.progress;

  if (!progress) {
    return <p style={{ color: 'var(--polly-text-muted)' }}>No memories yet.</p>;
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      {progress.litanies.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Litanies</h3>
          {progress.litanies.map((litany) => (
            <p key={litany}>{litany}</p>
          ))}
        </Layout>
      )}
      {progress.placeNames.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Places</h3>
          {progress.placeNames.map((place) => (
            <p key={place}>{place}</p>
          ))}
        </Layout>
      )}
      {progress.litanies.length === 0 && progress.placeNames.length === 0 && (
        <p style={{ color: 'var(--polly-text-muted)' }}>No memories collected.</p>
      )}
    </Layout>
  );
}

export function App() {
  const activeTab = useSignal<ViewId>('story');

  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <h1 style={{ margin: 0 }}>The Struggle</h1>
          <MeshControls />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="game.tab" />
      </Layout>
      <div>
        {activeTab.value === 'story' && <StoryView />}
        {activeTab.value === 'memory' && <MemoryView />}
      </div>
    </Layout>
  );
}
