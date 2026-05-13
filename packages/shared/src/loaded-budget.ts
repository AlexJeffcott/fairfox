/** Race a polly `$meshState.loaded` promise against a wall-clock
 * deadline. Resolves `true` if `.loaded` settled in time, `false` if
 * the deadline fired first. The original promise keeps running — we
 * just stop blocking on it.
 *
 * Why: `.loaded` waits for `handle.whenReady()` on the underlying
 * Automerge doc, which only resolves once the doc has been hydrated
 * from local storage or sync'd from a peer. On a brand-new origin
 * (fresh IndexedDB) with no peer yet streaming the doc — the exact
 * shape of a freshly-paired browser device in real Chrome — neither
 * happens, so awaiting `.loaded` hangs indefinitely. Bound the wait
 * so the surrounding flow can advance; CRDT reconciliation handles
 * any writes that needed-but-didn't-get the hydration. */
export function awaitLoadedBudget(loaded: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    loaded.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), ms);
    }),
  ]);
}
