import { describe, expect, test } from 'bun:test';
import { awaitLoadedBudget } from '#src/loaded-budget.ts';

describe('awaitLoadedBudget', () => {
  test('resolves true when the loaded promise settles before the deadline', async () => {
    const loaded = Promise.resolve();
    const hydrated = await awaitLoadedBudget(loaded, 100);
    expect(hydrated).toBe(true);
  });

  test('resolves false when the deadline fires before the loaded promise settles', async () => {
    // A promise that never resolves models polly's `$meshState.loaded`
    // awaiting `handle.whenReady()` on a doc that no peer is yet syncing.
    const never = new Promise<void>(() => {
      // intentionally never resolves
    });
    const start = Date.now();
    const hydrated = await awaitLoadedBudget(never, 50);
    const elapsed = Date.now() - start;
    expect(hydrated).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
  });

  test('does not throw when the loaded promise rejects after the deadline', async () => {
    // If the underlying promise rejects later, the budget caller has
    // already moved on — but the unhandled rejection should not crash
    // the surrounding context. We swallow the rejection by attaching
    // a no-op catch to the original promise; the budget helper's race
    // resolves with the timer first.
    const rejected = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('post-budget failure')), 30);
    });
    rejected.catch(() => {
      // swallow — race already resolved
    });
    const hydrated = await awaitLoadedBudget(rejected, 5);
    expect(hydrated).toBe(false);
  });
});
