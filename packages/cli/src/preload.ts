// Preload: runs first in the bundle so we can patch `console.warn`
// before any other module imports do. The warning filter in bin.ts
// was ineffective because ES module imports hoist above top-of-file
// code; making this the first import in bin.ts guarantees it runs
// before any transitive import (polly → automerge-wasm) can emit.
//
// Filtered:
//   - automerge-wasm's "using deprecated parameters for `initSync()`"
//     and "using deprecated parameters for the initialization
//     function" — both are `console.warn` calls.
//   - `TimeoutNegativeWarning` (emitted as a Node process warning by
//     `setTimeout(cb, negativeDelay)`) — NODE_NO_WARNINGS=1 in the
//     wrapper shim already covers this; the process.on handler here
//     is belt-and-braces for direct-invoked bundles.

const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]): void => {
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('deprecated parameters for `initSync()`')) {
    return;
  }
  if (msg.includes('deprecated parameters for the initialization function')) {
    return;
  }
  originalWarn(...args);
};

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'TimeoutNegativeWarning') {
    return;
  }
  const msg = String(w.message ?? '');
  if (msg.includes('deprecated parameters for `initSync()`')) {
    return;
  }
  process.stderr.write(`(node:warn) ${w.name}: ${msg}\n`);
});
