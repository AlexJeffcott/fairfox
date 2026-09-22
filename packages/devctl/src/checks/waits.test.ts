import { describe, expect, test } from 'bun:test';
import { findFixedWaits } from './waits.ts';

const SLEEP = 'Bun.sleep';
const TAKEN = 'Bun.sleep, destructured';
const IMPORT = 'a sleep imported from bun or timers/promises';
const TIMER = 'a timer that resolves a promise';

// Each form found by the cold read of rebuild-local, eal's four patterns, and
// each name the check knows, with the reason it gives.
const waits: readonly [string, string, readonly string[]][] = [
  ['Bun.sleep', 'await Bun.sleep(100);', [SLEEP]],
  ['Bun.sleepSync', 'Bun.sleepSync(100);', [SLEEP]],
  ['Bun.sleep kept, not called', 'const nap = Bun.sleep;', [SLEEP]],
  ['Bun.sleep by index', "await Bun['sleep'](100);", [SLEEP]],
  ['Bun.sleep by a template index', 'await Bun[`sleep`](100);', [SLEEP]],
  ['a destructured Bun.sleep', 'const { sleep } = Bun;\nawait sleep(100);', [TAKEN]],
  ['Bun.sleepSync destructured under another name', 'const { file, sleepSync: nap } = Bun;', [TAKEN]],
  ['Bun.sleep destructured in a parameter', 'function f({ sleep } = Bun) {}', [TAKEN]],
  ['Bun.sleep destructured in a nested default', 'const { a: { sleep } = Bun } = options;', [TAKEN]],
  ['sleep imported from bun', "import { sleep } from 'bun';", [IMPORT]],
  ['sleepSync imported from bun under another name', "import { file, sleepSync as nap } from 'bun';", [IMPORT]],
  ['setTimeout from node:timers/promises', "import { setTimeout } from 'node:timers/promises';\nawait setTimeout(100);", [IMPORT]],
  ['setTimeout renamed from timers/promises', "import { setTimeout as wait } from 'timers/promises';", [IMPORT]],
  ['timers/promises as a namespace', "import * as timers from 'node:timers/promises';", [IMPORT]],
  ['a promise resolved by setTimeout', 'await new Promise((r) => setTimeout(r, 100));', [TIMER]],
  ['setTimeout(ok, 100) in a promise', 'await new Promise((ok) => {\n  setTimeout(ok, 100);\n});', [TIMER]],
  ['setTimeout(() => resolve(), 100) in a promise', 'await new Promise((resolve) => {\n  setTimeout(() => resolve(), 100);\n});', [TIMER]],
  [
    'a function that resolves, deep in a promise',
    'await new Promise(function (go) {\n  globalThis.setTimeout(function () {\n    if (ready) {\n      go(undefined);\n    }\n  }, 100);\n});',
    [TIMER],
  ],
  ['setInterval resolving a promise', 'await new Promise((go) => setInterval(go, 100));', [TIMER]],
  ['window.setTimeout resolving a promise', 'await new Promise((go) => window.setTimeout(go, 100));', [TIMER]],
  ['global.setTimeout resolving a promise', 'await new Promise((go) => global.setTimeout(go, 100));', [TIMER]],
  ['self.setTimeout resolving a promise', 'await new Promise((go) => self.setTimeout(go, 100));', [TIMER]],
  ['globalThis.setInterval resolving a promise', 'await new Promise((go) => globalThis.setInterval(go, 100));', [TIMER]],
  ['a timer handed resolve', 'setTimeout(resolve, 100);', [TIMER]],
  ['a timer handed res', 'setTimeout(res, 100);', [TIMER]],
  ['a timer handed done', 'setTimeout(done, 100);', [TIMER]],
  ['a timer handed _resolve', 'setTimeout(_resolve, 100);', [TIMER]],
  ['a timer handed r', 'setTimeout(r, 100);', [TIMER]],
  ['a timer handed ok', 'setTimeout(ok, 100);', [TIMER]],
  ['a resolve from Promise.withResolvers', 'const { promise, resolve } = Promise.withResolvers();\nsetTimeout(resolve, 100);', [TIMER]],
  ['waitForTimeout', 'await page.waitForTimeout(500);', ['waitForTimeout']],
];

// Near misses: each is one step from a form above, and none is a fixed wait.
const notWaits: readonly [string, string][] = [
  ['a string that names a wait', "const s = 'await Bun.sleep(100)';"],
  ['a template that names a wait', 'const s = `await new Promise((r) => setTimeout(r, 100))`;'],
  ['a comment that names a wait', '// await Bun.sleep(100)\n/* setTimeout(resolve, 100) */'],
  ['a check that Bun exists', "if (typeof Bun !== 'undefined') {}"],
  ['another member of Bun', "await Bun.file('x').text();\nBun['file']('x');"],
  ['another object with a sleep', "await clock.sleep(100);\nclock['sleep'](100);\nclock.sleepSync(1);"],
  ['Bun indexed by a variable', "const sleep = 'file';\nBun[sleep];"],
  ['another member of Bun, destructured', 'const { file } = Bun;'],
  ['a sleep destructured from another object', 'const { sleep } = clock;\nfunction f({ sleep } = clock) {}'],
  ['a string that reads Bun, destructured', "const { sleep } = 'Bun';"],
  ['Bun destructured as an array', 'const [sleep] = Bun;'],
  ['Bun kept whole', 'const b = Bun;\nlet later;'],
  ['another import from bun', "import { file } from 'bun';"],
  ['the namespace of bun, whose sleep this check cannot follow', "import * as bun from 'bun';\nimport Bun2 from 'bun';"],
  ['bun imported for its side effects', "import 'bun';"],
  ['sleep imported from another module', "import { sleep } from './clock';"],
  ['setImmediate from node:timers', "import { setImmediate } from 'node:timers';"],
  ['a time limit that rejects', "await new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 10_000));"],
  ['a timer that runs a job', 'const timer = setTimeout(tick, 1000);\nclearTimeout(timer);'],
  ['a timer with no callback', 'setTimeout();'],
  ['a check that setTimeout exists', "if (typeof setTimeout === 'function') {}"],
  ['another object with a setTimeout', 'await new Promise((go) => clock.setTimeout(go, 100));'],
  ['a frame, not a timer', 'await new Promise((resolve) => window.requestAnimationFrame(resolve));'],
  ['a promise-like that is not a Promise', 'await new Deferred((go) => setTimeout(go, 100));'],
  ['a promise made from a named executor', 'await new Promise(start);'],
  ['a promise made with no executor', 'new Promise();\nnew Promise;'],
  ['an executor with no parameter', 'await new Promise(() => setTimeout(tick, 100));'],
  ['an executor that destructures its parameter', 'await new Promise(({ go }) => setTimeout(() => go(), 100));'],
  ['a timer in a promise that calls another function', 'await new Promise((go) => setTimeout(() => tick(), 100));'],
  ['a timer in a promise whose callback is a value', "await new Promise((go) => setTimeout('go()', 100));"],
  ['a timer in a promise handed what resolve returns, at once', 'await new Promise((go) => setTimeout(go(), 100));'],
  ['another method named like a wait', "await page.waitForSelector('.x');\nwaitForTimeout(500);"],
];

describe('findFixedWaits', () => {
  for (const [name, source, reasons] of waits) {
    test(`finds ${name}`, () => {
      expect(findFixedWaits('a.ts', source).map((f) => f.reason)).toEqual([...reasons]);
    });
  }
  for (const [name, source] of notWaits) {
    test(`leaves ${name}`, () => {
      expect(findFixedWaits('a.ts', source)).toEqual([]);
    });
  }
  test('reports each wait once, in the order of its lines, with its text', () => {
    const source = 'await new Promise((go) => {\n  Bun.sleepSync(1);\n  setTimeout(go, 1);\n});';
    expect(findFixedWaits('a.ts', source)).toEqual([
      { file: 'a.ts', line: 2, text: 'Bun.sleepSync', reason: SLEEP },
      { file: 'a.ts', line: 3, text: 'setTimeout(go, 1)', reason: TIMER },
    ]);
  });
});
