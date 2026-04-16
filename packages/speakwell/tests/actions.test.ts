// Unit tests for Speakwell's action registry.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';

let sessionsState: typeof import('../src/client/state.ts').sessionsState;
let registry: typeof import('../src/client/actions.ts').registry;

beforeAll(async () => {
  const repo = new Repo({ network: [] });
  configureMeshState(repo);
  const stateMod = await import('../src/client/state.ts');
  const actionsMod = await import('../src/client/actions.ts');
  sessionsState = stateMod.sessionsState;
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
  sessionsState.value = { sessions: [] };
});

describe('session.start', () => {
  test('creates a new session with the chosen format and language', () => {
    handler('session.start')(
      ctx({ format: 'yarn', language: 'en-GB', speaker: 'Alex', topic: 'an old bridge' })
    );
    expect(sessionsState.value.sessions.length).toBe(1);
    expect(sessionsState.value.sessions[0]?.format).toBe('yarn');
    expect(sessionsState.value.sessions[0]?.language).toBe('en-GB');
    expect(sessionsState.value.sessions[0]?.speaker).toBe('Alex');
    expect(sessionsState.value.sessions[0]?.endedAt).toBeNull();
  });

  test('rejects an invalid format', () => {
    handler('session.start')(ctx({ format: 'rant', language: 'en-GB', speaker: 'Alex' }));
    expect(sessionsState.value.sessions.length).toBe(0);
  });

  test('rejects an invalid language', () => {
    handler('session.start')(ctx({ format: 'yarn', language: 'fr-FR', speaker: 'Alex' }));
    expect(sessionsState.value.sessions.length).toBe(0);
  });
});

describe('session.add-turn and session.end', () => {
  test('adds a speaker turn then a coach turn, then ends', () => {
    handler('session.start')(ctx({ format: 'pitch', language: 'en-GB', speaker: 'Alex' }));
    const id = sessionsState.value.sessions[0]?.id;
    if (!id) {
      throw new Error('no id');
    }
    handler('session.add-turn')(ctx({ id, role: 'speaker', value: 'My idea is...' }));
    handler('session.add-turn')(ctx({ id, role: 'coach', value: 'Try leading with the problem.' }));
    handler('session.end')(ctx({ id }));
    expect(sessionsState.value.sessions[0]?.turns.length).toBe(2);
    expect(sessionsState.value.sessions[0]?.endedAt).not.toBeNull();
  });
});

describe('session.rate', () => {
  test('records a rating between 1 and 5', () => {
    handler('session.start')(ctx({ format: 'summary', language: 'en-GB', speaker: 'Alex' }));
    const id = sessionsState.value.sessions[0]?.id;
    if (!id) {
      throw new Error('no id');
    }
    handler('session.rate')(ctx({ id, rating: '4' }));
    expect(sessionsState.value.sessions[0]?.rating).toBe(4);
  });

  test('rejects ratings outside 1-5', () => {
    handler('session.start')(ctx({ format: 'summary', language: 'en-GB', speaker: 'Alex' }));
    const id = sessionsState.value.sessions[0]?.id;
    if (!id) {
      throw new Error('no id');
    }
    handler('session.rate')(ctx({ id, rating: '7' }));
    expect(sessionsState.value.sessions[0]?.rating).toBeNull();
  });
});
