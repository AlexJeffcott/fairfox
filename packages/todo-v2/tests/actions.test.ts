// Unit tests for the Todo sub-app's action registry.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';

let projectsState: typeof import('../src/client/state.ts').projectsState;
let tasksState: typeof import('../src/client/state.ts').tasksState;
let capturesState: typeof import('../src/client/state.ts').capturesState;
let registry: typeof import('../src/client/actions.ts').registry;

beforeAll(async () => {
  const repo = new Repo({ network: [] });
  configureMeshState(repo);
  const stateMod = await import('../src/client/state.ts');
  const actionsMod = await import('../src/client/actions.ts');
  projectsState = stateMod.projectsState;
  tasksState = stateMod.tasksState;
  capturesState = stateMod.capturesState;
  registry = actionsMod.registry;
});

function ctx(data: Record<string, string>): {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
} {
  return { data, event: new Event('click'), element: document.createElement('button') };
}

function handler(name: string): (c: ReturnType<typeof ctx>) => void {
  const h = registry[name];
  if (!h) {
    throw new Error(`handler ${name} not found`);
  }
  return h;
}

afterEach(() => {
  projectsState.value = { projects: [] };
  tasksState.value = { tasks: [] };
  capturesState.value = { captures: [] };
});

describe('project.create', () => {
  test('creates a project with the given name', () => {
    handler('project.create')(ctx({ value: 'i18n' }));
    expect(projectsState.value.projects.length).toBe(1);
    expect(projectsState.value.projects[0]?.name).toBe('i18n');
    expect(projectsState.value.projects[0]?.status).toBe('active');
  });

  test('does nothing when name is empty', () => {
    handler('project.create')(ctx({ value: '' }));
    expect(projectsState.value.projects.length).toBe(0);
  });
});

describe('project.update-status', () => {
  test('pauses a project', () => {
    handler('project.create')(ctx({ value: 'test-proj' }));
    const pid = projectsState.value.projects[0]?.pid;
    if (!pid) {
      throw new Error('no pid');
    }
    handler('project.update-status')(ctx({ pid, status: 'paused' }));
    expect(projectsState.value.projects[0]?.status).toBe('paused');
  });
});

describe('task.create', () => {
  test('creates a task with med priority by default', () => {
    handler('task.create')(ctx({ value: 'Fix the bug' }));
    expect(tasksState.value.tasks.length).toBe(1);
    expect(tasksState.value.tasks[0]?.description).toBe('Fix the bug');
    expect(tasksState.value.tasks[0]?.priority).toBe('med');
    expect(tasksState.value.tasks[0]?.done).toBe(false);
  });
});

describe('task.toggle-done', () => {
  test('toggles done state', () => {
    handler('task.create')(ctx({ value: 'Do it' }));
    const tid = tasksState.value.tasks[0]?.tid;
    if (!tid) {
      throw new Error('no tid');
    }
    handler('task.toggle-done')(ctx({ tid }));
    expect(tasksState.value.tasks[0]?.done).toBe(true);
    handler('task.toggle-done')(ctx({ tid }));
    expect(tasksState.value.tasks[0]?.done).toBe(false);
  });
});

describe('task.set-priority', () => {
  test('changes priority', () => {
    handler('task.create')(ctx({ value: 'Urgent' }));
    const tid = tasksState.value.tasks[0]?.tid;
    if (!tid) {
      throw new Error('no tid');
    }
    handler('task.set-priority')(ctx({ tid, priority: 'high' }));
    expect(tasksState.value.tasks[0]?.priority).toBe('high');
  });

  test('rejects invalid priority', () => {
    handler('task.create')(ctx({ value: 'X' }));
    const tid = tasksState.value.tasks[0]?.tid;
    if (!tid) {
      throw new Error('no tid');
    }
    handler('task.set-priority')(ctx({ tid, priority: 'ultra' }));
    expect(tasksState.value.tasks[0]?.priority).toBe('med');
  });
});

describe('capture', () => {
  test('adds and deletes a capture', () => {
    handler('capture.add')(ctx({ value: 'Look into solar panels' }));
    expect(capturesState.value.captures.length).toBe(1);
    expect(capturesState.value.captures[0]?.text).toBe('Look into solar panels');
    const id = capturesState.value.captures[0]?.id;
    if (!id) {
      throw new Error('no id');
    }
    handler('capture.delete')(ctx({ id }));
    expect(capturesState.value.captures.length).toBe(0);
  });
});
