// Unit tests for The Struggle action registry.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';

let storyState: typeof import('../src/client/state.ts').storyState;
let progressState: typeof import('../src/client/state.ts').progressState;
let registry: typeof import('../src/client/actions.ts').registry;

beforeAll(async () => {
  const repo = new Repo({ network: [] });
  configureMeshState(repo);
  const stateMod = await import('../src/client/state.ts');
  const actionsMod = await import('../src/client/actions.ts');
  storyState = stateMod.storyState;
  progressState = stateMod.progressState;
  registry = actionsMod.registry;
});

function fakeContext(data: Record<string, string>): {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
} {
  return {
    data,
    event: new Event('click'),
    element: document.createElement('button'),
  };
}

function seedStory() {
  storyState.value = {
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter One',
        startPassageId: 'p1',
        passages: [
          {
            id: 'p1',
            chapterId: 'ch1',
            title: 'Opening',
            content: { body: 'You wake in darkness.' },
            choices: [
              {
                id: 'c1',
                passageId: 'p1',
                targetPassageId: 'p2',
                label: 'Step forward',
                type: 'navigate',
              },
            ],
            isDeath: false,
          },
          {
            id: 'p2',
            chapterId: 'ch1',
            title: 'The corridor',
            content: { body: 'A long corridor stretches ahead.' },
            choices: [],
            isDeath: false,
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  storyState.value = { chapters: [] };
  progressState.value = { progress: null };
});

describe('game.init', () => {
  test('initialises progress at the first chapter start passage', () => {
    seedStory();
    const handler = registry['game.init'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({}));
    const progress = progressState.value.progress;
    expect(progress).not.toBeNull();
    expect(progress?.currentChapterId).toBe('ch1');
    expect(progress?.currentPassageId).toBe('p1');
    expect(progress?.visitedPassages).toEqual(['p1']);
  });

  test('does nothing when there are no chapters', () => {
    const handler = registry['game.init'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({}));
    expect(progressState.value.progress).toBeNull();
  });
});

describe('game.navigate', () => {
  test('moves to target passage and records visit', () => {
    seedStory();
    const initHandler = registry['game.init'];
    if (!initHandler) {
      throw new Error('handler not found');
    }
    initHandler(fakeContext({}));

    const navHandler = registry['game.navigate'];
    if (!navHandler) {
      throw new Error('handler not found');
    }
    navHandler(fakeContext({ choiceId: 'c1' }));

    const progress = progressState.value.progress;
    expect(progress?.currentPassageId).toBe('p2');
    expect(progress?.visitedPassages).toContain('p2');
  });

  test('does nothing without a choiceId', () => {
    seedStory();
    const initHandler = registry['game.init'];
    if (!initHandler) {
      throw new Error('handler not found');
    }
    initHandler(fakeContext({}));

    const navHandler = registry['game.navigate'];
    if (!navHandler) {
      throw new Error('handler not found');
    }
    navHandler(fakeContext({}));

    expect(progressState.value.progress?.currentPassageId).toBe('p1');
  });
});

describe('game.reset', () => {
  test('clears progress to null', () => {
    seedStory();
    const initHandler = registry['game.init'];
    if (!initHandler) {
      throw new Error('handler not found');
    }
    initHandler(fakeContext({}));
    expect(progressState.value.progress).not.toBeNull();

    const resetHandler = registry['game.reset'];
    if (!resetHandler) {
      throw new Error('handler not found');
    }
    resetHandler(fakeContext({}));
    expect(progressState.value.progress).toBeNull();
  });
});
