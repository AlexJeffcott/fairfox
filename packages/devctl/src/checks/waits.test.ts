import { describe, expect, test } from 'bun:test';
import { findFixedWaits } from './waits.ts';

// Each form found by the cold read of rebuild-local, and eal's four patterns.
const waits: readonly [string, string][] = [
  ['Bun.sleep', 'await Bun.sleep(100);'],
  ['Bun.sleepSync', 'Bun.sleepSync(100);'],
  ['Bun.sleep by index', "await Bun['sleep'](100);"],
  ['a destructured Bun.sleep', 'const { sleep } = Bun;\nawait sleep(100);'],
  ['sleep imported from bun', "import { sleep } from 'bun';"],
  ['setTimeout from node:timers/promises', "import { setTimeout } from 'node:timers/promises';\nawait setTimeout(100);"],
  ['setTimeout renamed from timers/promises', "import { setTimeout as wait } from 'timers/promises';"],
  ['timers/promises as a namespace', "import * as timers from 'node:timers/promises';"],
  ['timers/promises imported at run time', "const { setTimeout } = await import('node:timers/promises');"],
  ['a promise resolved by setTimeout', 'await new Promise((r) => setTimeout(r, 100));'],
  ['setTimeout(ok, 100) in a promise', 'await new Promise((ok) => {\n  setTimeout(ok, 100);\n});'],
  ['setTimeout(() => resolve(), 100) in a promise', 'await new Promise((resolve) => {\n  setTimeout(() => resolve(), 100);\n});'],
  [
    'a function that resolves, in a promise',
    'await new Promise(function (go) {\n  globalThis.setTimeout(function () {\n    go(undefined);\n  }, 100);\n});',
  ],
  ['a resolve from Promise.withResolvers', 'const { promise, resolve } = Promise.withResolvers();\nsetTimeout(resolve, 100);'],
  ['waitForTimeout', 'await page.waitForTimeout(500);'],
];

const notWaits: readonly [string, string][] = [
  ['a string that names a wait', "const s = 'await Bun.sleep(100)';"],
  ['a template that names a wait', 'const s = `await new Promise((r) => setTimeout(r, 100))`;'],
  ['a comment that names a wait', '// await Bun.sleep(100)\n/* setTimeout(resolve, 100) */'],
  ['a time limit that rejects', "await new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 10_000));"],
  ['a timer that runs a job', 'const timer = setTimeout(tick, 1000);\nclearTimeout(timer);'],
  ['setImmediate from node:timers', "import { setImmediate } from 'node:timers';"],
];

describe('findFixedWaits', () => {
  for (const [name, source] of waits) {
    test(`finds ${name}`, () => {
      expect(findFixedWaits('a.ts', source)).toHaveLength(1);
    });
  }
  for (const [name, source] of notWaits) {
    test(`leaves ${name}`, () => {
      expect(findFixedWaits('a.ts', source)).toEqual([]);
    });
  }
});
