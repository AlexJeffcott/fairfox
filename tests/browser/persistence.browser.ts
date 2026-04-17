// Browser test: $meshState documents should persist across Repo lifetimes.
//
// The user-visible bug: open todo-v2 on a lone device (no paired peer),
// add a task, refresh the page, the task is gone. Adding an IndexedDB
// storage adapter to the Repo was necessary but not sufficient.
//
// Polly 0.25.0's $meshState keeps the logical-key → DocumentId map
// purely in-memory per Repo (see keyMapsByRepo in mesh-state.ts). With a
// storage adapter the document bytes survive reload, but a fresh Repo
// has no way to find them: $meshState('todo:tasks', ...) on boot creates
// a brand-new document with a new DocumentId, and the old data is
// orphaned in IndexedDB. Paired devices with an online peer hide the
// problem through sync; lone devices lose state on every reload.
//
// This test is intentionally red until polly gains deterministic
// DocumentIds or a persisted keyMap. Keeping the test in the suite is
// the regression guard — the failure reminds us the fix isn't in yet.

import { Repo } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { $meshState, configureMeshState, resetMeshState } from '@fairfox/polly/mesh';
import { describe, done, expect, flush, test } from '@fairfox/polly/test/browser';

interface Doc {
  [key: string]: unknown;
  items: string[];
}

const STORAGE_NAME = 'fairfox-test-persistence';
const DOC_KEY = 'test:persistence';

describe('$meshState persistence on a lone device', () => {
  test('data written in one Repo should be readable from a fresh Repo on the same storage', async () => {
    resetMeshState();
    const storageA = new IndexedDBStorageAdapter(STORAGE_NAME);
    const repoA = new Repo({ network: [], storage: storageA });
    configureMeshState(repoA);

    const writer = $meshState<Doc>(DOC_KEY, { items: [] });
    await writer.loaded;
    writer.value = { items: ['first', 'second'] };
    await flush(50);
    await repoA.flush();

    resetMeshState();
    const storageB = new IndexedDBStorageAdapter(STORAGE_NAME);
    const repoB = new Repo({ network: [], storage: storageB });
    configureMeshState(repoB);

    const reader = $meshState<Doc>(DOC_KEY, { items: [] });
    await reader.loaded;
    expect(reader.value.items).toEqual(['first', 'second']);
  });
});

done();
