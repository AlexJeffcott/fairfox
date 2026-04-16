// Unit tests for family-phone-admin's action registry.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Repo } from '@automerge/automerge-repo';
import { configureMeshState } from '@fairfox/polly/mesh';

let directoryState: typeof import('../src/client/state.ts').directoryState;
let registry: typeof import('../src/client/actions.ts').registry;

beforeAll(async () => {
  const repo = new Repo({ network: [] });
  configureMeshState(repo);
  const stateMod = await import('../src/client/state.ts');
  const actionsMod = await import('../src/client/actions.ts');
  directoryState = stateMod.directoryState;
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
  directoryState.value = { humans: [], devices: [] };
});

describe('human.add and human.remove', () => {
  test('adds a human then removes them by id', () => {
    handler('human.add')(ctx({ value: 'Elisa' }));
    const id = directoryState.value.humans[0]?.id;
    if (!id) {
      throw new Error('no id');
    }
    expect(directoryState.value.humans.length).toBe(1);
    handler('human.remove')(ctx({ id }));
    expect(directoryState.value.humans.length).toBe(0);
  });

  test('rejects empty names', () => {
    handler('human.add')(ctx({ value: '' }));
    expect(directoryState.value.humans.length).toBe(0);
  });
});

describe('device.register and device.revoke', () => {
  test('registers a device against a human then revokes it', () => {
    handler('human.add')(ctx({ value: 'Leo' }));
    const humanId = directoryState.value.humans[0]?.id;
    if (!humanId) {
      throw new Error('no humanId');
    }
    handler('device.register')(
      ctx({ humanId, name: "Leo's tablet", kind: 'tablet', publicKey: 'abc123' })
    );
    expect(directoryState.value.devices.length).toBe(1);
    expect(directoryState.value.devices[0]?.humanId).toBe(humanId);
    expect(directoryState.value.devices[0]?.revokedAt).toBeNull();

    const deviceId = directoryState.value.devices[0]?.id;
    if (!deviceId) {
      throw new Error('no deviceId');
    }
    handler('device.revoke')(ctx({ id: deviceId }));
    expect(directoryState.value.devices[0]?.revokedAt).not.toBeNull();
  });

  test('rejects unknown device kinds', () => {
    handler('device.register')(
      ctx({ humanId: 'H1', name: 'mystery', kind: 'toaster', publicKey: '' })
    );
    expect(directoryState.value.devices.length).toBe(0);
  });
});

describe('device.rename', () => {
  test('updates a device name', () => {
    handler('human.add')(ctx({ value: 'Alex' }));
    const humanId = directoryState.value.humans[0]?.id;
    if (!humanId) {
      throw new Error('no humanId');
    }
    handler('device.register')(ctx({ humanId, name: 'laptop', kind: 'laptop', publicKey: '' }));
    const deviceId = directoryState.value.devices[0]?.id;
    if (!deviceId) {
      throw new Error('no deviceId');
    }
    handler('device.rename')(ctx({ id: deviceId, value: 'work laptop' }));
    expect(directoryState.value.devices[0]?.name).toBe('work laptop');
  });
});
