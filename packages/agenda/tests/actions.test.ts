// Unit tests for the Agenda sub-app's action registry.
//
// Tests verify that action handlers produce the expected $meshState
// mutations. The mesh transport is not involved — these test the
// handler logic in isolation against the in-process signal.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';

let agenda: typeof import('../src/client/state.ts').agenda;
let registry: typeof import('../src/client/actions.ts').registry;

beforeAll(async () => {
  const repo = new Repo({ network: [] });
  configureMeshState(repo);
  const stateMod = await import('../src/client/state.ts');
  const actionsMod = await import('../src/client/actions.ts');
  agenda = stateMod.agenda;
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
  agenda.value = { items: [], completions: [] };
});

describe('item.create', () => {
  test('adds a chore with the given name', () => {
    const handler = registry['item.create'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: 'Wash dishes' }));
    expect(agenda.value.items.length).toBe(1);
    expect(agenda.value.items[0]?.name).toBe('Wash dishes');
    expect(agenda.value.items[0]?.kind).toBe('chore');
    expect(agenda.value.items[0]?.active).toBe(true);
  });

  test('does nothing when name is empty', () => {
    const handler = registry['item.create'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ value: '' }));
    expect(agenda.value.items.length).toBe(0);
  });
});

describe('item.delete', () => {
  test('removes the item with the given id', () => {
    agenda.value = {
      items: [
        { id: 'a', kind: 'chore', name: 'A', recurrence: 'daily', points: 1, active: true },
        { id: 'b', kind: 'chore', name: 'B', recurrence: 'daily', points: 1, active: true },
      ],
      completions: [],
    };
    const handler = registry['item.delete'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ id: 'a' }));
    expect(agenda.value.items.length).toBe(1);
    expect(agenda.value.items[0]?.id).toBe('b');
  });
});

describe('chore.done', () => {
  test('records a completion for the given item and person', () => {
    agenda.value = {
      items: [
        { id: 'c1', kind: 'chore', name: 'Vacuum', recurrence: 'daily', points: 2, active: true },
      ],
      completions: [],
    };
    const handler = registry['chore.done'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ itemId: 'c1', person: 'Alex' }));
    expect(agenda.value.completions.length).toBe(1);
    expect(agenda.value.completions[0]?.person).toBe('Alex');
    expect(agenda.value.completions[0]?.kind).toBe('done');
    expect(agenda.value.completions[0]?.itemId).toBe('c1');
  });

  test('does nothing when person is missing', () => {
    const handler = registry['chore.done'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ itemId: 'c1' }));
    expect(agenda.value.completions.length).toBe(0);
  });
});

describe('chore.snooze', () => {
  test('records a snooze completion', () => {
    const handler = registry['chore.snooze'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ itemId: 'c1', person: 'Elisa', days: '3' }));
    expect(agenda.value.completions.length).toBe(1);
    expect(agenda.value.completions[0]?.kind).toBe('snooze-3d');
  });

  test('rejects invalid snooze durations', () => {
    const handler = registry['chore.snooze'];
    if (!handler) {
      throw new Error('handler not found');
    }
    handler(fakeContext({ itemId: 'c1', person: 'Leo', days: '5' }));
    expect(agenda.value.completions.length).toBe(0);
  });
});
