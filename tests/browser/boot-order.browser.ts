// Browser test: state.ts module evaluation order.
//
// The bug this catches: state.ts calls $meshState(...) at module top
// level. If configureMeshState has not run yet, polly's resolveRepo
// throws synchronously. The production fix is @fairfox/shared/ensure-mesh
// — a top-level-await module that every state.ts imports first so the
// Repo is configured before the primitives evaluate.
//
// The previous happy-dom unit tests deliberately bypassed this ordering
// by calling configureMeshState manually in beforeAll and then
// dynamically importing state.ts. That structure made the bug invisible
// to the test suite.

import { Repo } from '@automerge/automerge-repo';
import { $meshState, configureMeshState, resetMeshState } from '@fairfox/polly/mesh';
import { describe, done, expect, test } from '@fairfox/polly/test/browser';

describe('mesh-state primitive ordering', () => {
  test('throws when called before configureMeshState', () => {
    resetMeshState();
    let thrown: Error | null = null;
    try {
      $meshState<{ items: string[] }>('test:no-repo', { items: [] });
    } catch (err) {
      thrown = err instanceof Error ? err : new Error(String(err));
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message ?? '').toContain('no Repo configured');
  });

  test('resolves when configureMeshState has run first', async () => {
    resetMeshState();
    const repo = new Repo({ network: [] });
    configureMeshState(repo);
    const state = $meshState<{ items: string[] }>('test:ordered', { items: [] });
    await state.loaded;
    expect(state.value.items).toHaveLength(0);
  });
});

done();
