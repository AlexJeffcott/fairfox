/** @jsxImportSource preact */
// The Struggle — interactive reader UI plus a story editor.
// Three views: Story (current passage + choices), Memory (litanies +
// places), and Edit (author chapters, passages, and choices).

import { ActionInput, Button, Checkbox, Layout, Surface, Tabs } from '@fairfox/polly/ui';
import { renderMarkdown } from '@fairfox/polly/ui/markdown';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { effect } from '@preact/signals';
import type { Chapter, Choice, Passage } from '#src/client/state.ts';
import {
  editChapterId,
  editPassageId,
  progressState,
  storyState,
  theStruggleActiveTab,
} from '#src/client/state.ts';

const TAB_LIST = [
  { id: 'story', label: 'Story' },
  { id: 'memory', label: 'Memory' },
  { id: 'edit', label: 'Edit' },
];

const SELECT_STYLE = {
  font: 'inherit',
  padding: 'var(--polly-space-sm) var(--polly-space-md)',
  border: '1px solid var(--polly-border)',
  borderRadius: 'var(--polly-radius-md)',
  background: 'var(--polly-surface)',
  color: 'var(--polly-text)',
  minWidth: 0,
} as const;

const TRUNCATE = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

function FieldLabel({ children }: { children: preact.ComponentChildren }) {
  return (
    <span style={{ fontSize: 'var(--polly-text-sm)', color: 'var(--polly-text-muted)' }}>
      {children}
    </span>
  );
}

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

// --- Editor -----------------------------------------------------

function ChapterList({ chapters }: { chapters: Chapter[] }) {
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="minmax(0, 1fr) auto" gap="var(--polly-space-sm)" alignItems="center">
        <h2 style={{ margin: 0 }}>Chapters</h2>
        <Button label="+ New chapter" tier="primary" size="small" data-action="chapter.create" />
      </Layout>
      {chapters.length === 0 ? (
        <p style={{ color: 'var(--polly-text-muted)' }}>
          No chapters yet. Create one to start writing.
        </p>
      ) : (
        chapters.map((chapter) => (
          <Layout
            key={chapter.id}
            columns="minmax(0, 1fr) auto"
            gap="var(--polly-space-sm)"
            alignItems="center"
          >
            <Layout rows="auto auto" gap="0">
              <strong style={TRUNCATE}>{chapter.title || '(untitled chapter)'}</strong>
              <FieldLabel>{chapter.passages.length} passages</FieldLabel>
            </Layout>
            <Button
              label="Edit"
              tier="secondary"
              size="small"
              data-action="struggle.edit-open-chapter"
              data-action-chapter-id={chapter.id}
            />
          </Layout>
        ))
      )}
    </Layout>
  );
}

function ChapterEditor({ chapter }: { chapter: Chapter }) {
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="auto minmax(0, 1fr)" gap="var(--polly-space-sm)" alignItems="center">
        <Button
          label="← Chapters"
          tier="tertiary"
          size="small"
          data-action="struggle.edit-close-chapter"
        />
        <strong style={TRUNCATE}>{chapter.title || '(untitled chapter)'}</strong>
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <FieldLabel>Chapter title</FieldLabel>
        <ActionInput
          value={chapter.title}
          variant="single"
          action="chapter.update"
          saveOn="blur"
          placeholder="Chapter title"
          ariaLabel="Chapter title"
          actionData={{ field: 'title', chapterId: chapter.id }}
        />
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <FieldLabel>Start passage</FieldLabel>
        <select
          data-action="chapter.update"
          data-action-field="startPassageId"
          data-action-chapter-id={chapter.id}
          value={chapter.startPassageId}
          style={SELECT_STYLE}
        >
          <option value="">(choose a passage)</option>
          {chapter.passages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || p.id}
            </option>
          ))}
        </select>
      </Layout>

      <Layout columns="minmax(0, 1fr) auto" gap="var(--polly-space-sm)" alignItems="center">
        <h3 style={{ margin: 0 }}>Passages</h3>
        <Button label="+ New passage" tier="primary" size="small" data-action="passage.create" />
      </Layout>
      {chapter.passages.length === 0 ? (
        <p style={{ color: 'var(--polly-text-muted)' }}>No passages yet.</p>
      ) : (
        chapter.passages.map((passage) => (
          <Layout
            key={passage.id}
            columns="minmax(0, 1fr) auto auto"
            gap="var(--polly-space-sm)"
            alignItems="center"
          >
            <Layout rows="auto auto" gap="0">
              <strong style={TRUNCATE}>{passage.title || '(untitled passage)'}</strong>
              <FieldLabel>
                {passage.choices.length} choice{passage.choices.length === 1 ? '' : 's'}
                {passage.isDeath ? ' · death' : ''}
                {chapter.startPassageId === passage.id ? ' · start' : ''}
              </FieldLabel>
            </Layout>
            <Button
              label="Edit"
              tier="secondary"
              size="small"
              data-action="struggle.edit-open-passage"
              data-action-passage-id={passage.id}
            />
            <Button
              label="×"
              tier="tertiary"
              color="danger"
              size="small"
              data-action="passage.delete"
              data-action-passage-id={passage.id}
            />
          </Layout>
        ))
      )}

      <Button
        label="Delete chapter"
        tier="tertiary"
        color="danger"
        size="small"
        data-action="chapter.delete"
        data-action-chapter-id={chapter.id}
      />
    </Layout>
  );
}

function ChoiceEditor({ choice, chapter }: { choice: Choice; chapter: Chapter }) {
  return (
    <Surface variant="sunken" padding="var(--polly-space-sm)" radius="md">
      <Layout rows="auto" gap="var(--polly-space-xs)">
        <ActionInput
          value={choice.label}
          variant="single"
          action="choice.update"
          saveOn="blur"
          placeholder="Choice label"
          ariaLabel="Choice label"
          actionData={{ field: 'label', choiceId: choice.id }}
        />
        <Layout columns="1fr 1fr" gap="var(--polly-space-xs)" stackOnMobile={true}>
          <select
            data-action="choice.update"
            data-action-field="type"
            data-action-choice-id={choice.id}
            value={choice.type}
            style={SELECT_STYLE}
          >
            <option value="navigate">navigate</option>
            <option value="inspect">inspect</option>
          </select>
          <select
            data-action="choice.update"
            data-action-field="targetPassageId"
            data-action-choice-id={choice.id}
            value={choice.targetPassageId}
            style={SELECT_STYLE}
          >
            <option value="">(target passage)</option>
            {chapter.passages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || p.id}
              </option>
            ))}
          </select>
        </Layout>
        <Button
          label="Delete choice"
          tier="tertiary"
          color="danger"
          size="small"
          data-action="choice.delete"
          data-action-choice-id={choice.id}
        />
      </Layout>
    </Surface>
  );
}

function PassageEditor({ chapter, passage }: { chapter: Chapter; passage: Passage }) {
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      <Layout columns="auto minmax(0, 1fr)" gap="var(--polly-space-sm)" alignItems="center">
        <Button
          label="← Passages"
          tier="tertiary"
          size="small"
          data-action="struggle.edit-close-passage"
        />
        <strong style={TRUNCATE}>{passage.title || '(untitled passage)'}</strong>
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <FieldLabel>Title</FieldLabel>
        <ActionInput
          value={passage.title}
          variant="single"
          action="passage.update"
          saveOn="blur"
          placeholder="Passage title"
          ariaLabel="Passage title"
          actionData={{ field: 'title', passageId: passage.id }}
        />
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <FieldLabel>Body</FieldLabel>
        <ActionInput
          value={passage.content.body}
          variant="multi"
          action="passage.update"
          saveOn="blur"
          placeholder="The passage text the reader sees…"
          ariaLabel="Passage body"
          actionData={{ field: 'body', passageId: passage.id }}
        />
      </Layout>

      <Layout rows="auto" gap="var(--polly-space-xs)">
        <FieldLabel>Preamble (optional)</FieldLabel>
        <ActionInput
          value={passage.content.preamble ?? ''}
          variant="multi"
          action="passage.update"
          saveOn="blur"
          placeholder="Italic line shown beneath the body"
          ariaLabel="Preamble"
          actionData={{ field: 'preamble', passageId: passage.id }}
        />
      </Layout>

      <Layout columns="auto minmax(0, 1fr)" gap="var(--polly-space-sm)" alignItems="center">
        <Checkbox
          checked={passage.isDeath}
          data-action="passage.toggle-death"
          data-action-passage-id={passage.id}
        />
        <span>This passage is a dead end</span>
      </Layout>

      <Layout columns="minmax(0, 1fr) auto" gap="var(--polly-space-sm)" alignItems="center">
        <h3 style={{ margin: 0 }}>Choices</h3>
        <Button
          label="+ New choice"
          tier="primary"
          size="small"
          data-action="choice.create"
          data-action-passage-id={passage.id}
        />
      </Layout>
      {passage.choices.length === 0 ? (
        <p style={{ color: 'var(--polly-text-muted)' }}>
          No choices — the reader stops here unless this passage is a dead end.
        </p>
      ) : (
        passage.choices.map((choice) => (
          <ChoiceEditor key={choice.id} choice={choice} chapter={chapter} />
        ))
      )}

      <Button
        label="Delete passage"
        tier="tertiary"
        color="danger"
        size="small"
        data-action="passage.delete"
        data-action-passage-id={passage.id}
      />
    </Layout>
  );
}

function EditView() {
  const chapters = storyState.value.chapters;
  const chapterId = editChapterId.value;
  const chapter = chapterId ? chapters.find((c) => c.id === chapterId) : undefined;
  if (!chapter) {
    return <ChapterList chapters={chapters} />;
  }
  const passageId = editPassageId.value;
  const passage = passageId ? chapter.passages.find((p) => p.id === passageId) : undefined;
  if (!passage) {
    return <ChapterEditor chapter={chapter} />;
  }
  return <PassageEditor chapter={chapter} passage={passage} />;
}

let theStruggleEffectsInstalled = false;

/** Publish the current Struggle tab as page-context. */
export function installTheStruggleEffects(): void {
  if (theStruggleEffectsInstalled) {
    return;
  }
  theStruggleEffectsInstalled = true;
  effect(() => {
    setPageContext({
      kind: 'struggle',
      label: `The Struggle · ${theStruggleActiveTab.value}`,
    });
  });
}

export function App() {
  const activeTab = theStruggleActiveTab.value;

  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <h1 style={{ margin: 0 }}>The Struggle</h1>
          <HubBack />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab} action="game.tab" />
      </Layout>
      <div>
        {activeTab === 'story' && <StoryView />}
        {activeTab === 'memory' && <MemoryView />}
        {activeTab === 'edit' && <EditView />}
      </div>
    </Layout>
  );
}
