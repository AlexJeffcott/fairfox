// Unit tests for the template sub-app's action registry.
//
// Tests verify that action handlers produce the expected $meshState
// mutations. The mesh transport is not involved — these test the
// handler logic in isolation against the in-process signal.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';

// Configure a local in-memory Repo before any $meshState call.
// This must happen before importing state.ts (which calls $meshState
// at module level), so we do it in beforeAll with a dynamic import.
let appState: typeof import('../src/client/state.ts').appState;
let registry: typeof import('../src/client/actions.ts').registry;

beforeAll(async () => {
  const repo = new Repo({ network: [] });
  configureMeshState(repo);
  const stateMod = await import('../src/client/state.ts');
  const actionsMod = await import('../src/client/actions.ts');
  appState = stateMod.appState;
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

afterEach(() => {
  appState.value = { items: [] };
});

describe('item.add', () => {
  test('appends an item when value is provided', () => {
    const handler = registry['item.add'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: 'hello' }));
    expect(appState.value.items).toEqual(['hello']);
  });

  test('does nothing when value is empty', () => {
    const handler = registry['item.add'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: '' }));
    expect(appState.value.items).toEqual([]);
  });
});

describe('item.remove', () => {
  test('removes the item at the given index', () => {
    appState.value = { items: ['a', 'b', 'c'] };
    const handler = registry['item.remove'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ index: '1' }));
    expect(appState.value.items).toEqual(['a', 'c']);
  });

  test('does nothing when index is not a number', () => {
    appState.value = { items: ['a'] };
    const handler = registry['item.remove'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ index: 'bad' }));
    expect(appState.value.items).toEqual(['a']);
  });
});
