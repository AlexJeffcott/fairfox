// Unit tests for the Library action registry.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';

let libraryState: typeof import('../src/client/state.ts').libraryState;
let registry: typeof import('../src/client/actions.ts').registry;

beforeAll(async () => {
  const repo = new Repo({ network: [] });
  configureMeshState(repo);
  const stateMod = await import('../src/client/state.ts');
  const actionsMod = await import('../src/client/actions.ts');
  libraryState = stateMod.libraryState;
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
  libraryState.value = { refs: [], docs: [] };
});

describe('ref.create', () => {
  test('adds a ref with the given title', () => {
    const handler = registry['ref.create'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: 'Moby Dick' }));
    expect(libraryState.value.refs).toHaveLength(1);
    expect(libraryState.value.refs[0]?.title).toBe('Moby Dick');
  });

  test('does nothing when value is empty', () => {
    const handler = registry['ref.create'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: '' }));
    expect(libraryState.value.refs).toHaveLength(0);
  });
});

describe('ref.delete', () => {
  test('removes the ref by id', () => {
    const handler = registry['ref.create'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: 'Book A' }));
    handler(fakeContext({ value: 'Book B' }));
    expect(libraryState.value.refs).toHaveLength(2);

    const idToDelete = libraryState.value.refs[0]?.id;
    if (!idToDelete) {
      throw new Error('no ref id');
    }
    const deleteHandler = registry['ref.delete'];
    if (!deleteHandler) {
      throw new Error('handler not found');
    }
    deleteHandler(fakeContext({ id: idToDelete }));
    expect(libraryState.value.refs).toHaveLength(1);
    expect(libraryState.value.refs[0]?.title).toBe('Book B');
  });
});

describe('doc.create', () => {
  test('adds a doc with the given title and empty content', () => {
    const handler = registry['doc.create'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: 'World Map' }));
    expect(libraryState.value.docs).toHaveLength(1);
    expect(libraryState.value.docs[0]?.title).toBe('World Map');
    expect(libraryState.value.docs[0]?.content).toBe('');
  });

  test('does nothing when value is empty', () => {
    const handler = registry['doc.create'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: '' }));
    expect(libraryState.value.docs).toHaveLength(0);
  });
});

describe('doc.delete', () => {
  test('removes the doc by id', () => {
    const createHandler = registry['doc.create'];
    if (!createHandler) {
      throw new Error('handler not found');
    }
    createHandler(fakeContext({ value: 'Doc A' }));
    createHandler(fakeContext({ value: 'Doc B' }));
    expect(libraryState.value.docs).toHaveLength(2);

    const idToDelete = libraryState.value.docs[0]?.id;
    if (!idToDelete) {
      throw new Error('no doc id');
    }
    const deleteHandler = registry['doc.delete'];
    if (!deleteHandler) {
      throw new Error('handler not found');
    }
    deleteHandler(fakeContext({ id: idToDelete }));
    expect(libraryState.value.docs).toHaveLength(1);
    expect(libraryState.value.docs[0]?.title).toBe('Doc B');
  });
});
