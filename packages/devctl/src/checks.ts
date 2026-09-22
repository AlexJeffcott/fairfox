/**
 * The checks `devctl ci` runs, in this order. To register a check, add one
 * entry to CHECKS below. Nothing else needs to change.
 *
 * This file is also the one place where the form of a red run is written down.
 *
 * M3: every check is seen red once, and the change that made it red is
 * recorded beside it. A check that cannot be made red is deleted. The record
 * is the check's `red` field: one or more RedChange entries, each an edit to
 * one file that turns the check red. The form follows pointer-deploy's
 * `falsify` array. `devctl ci --red` makes each edit in turn, runs the check,
 * puts the file back, and fails unless:
 *   - `find` occurs exactly once in `file`, so the edit lands where it is aimed;
 *   - the check exits non-zero with the edit in place;
 *   - the check's output contains `output`, so it went red for this edit and
 *     not for another reason (a build that broke, a check that never ran);
 *   - every check it ran is green again once the files are back.
 * To see a new check red once: add its entry, then run
 * `devctl ci --red --only <name>`.
 */

/** One edit that turns a check red. */
export type RedChange = {
  /** What the edit breaks, in one line. */
  breaks: string;
  /** The file to edit, from the root of the checkout. */
  file: string;
  /** Text that occurs exactly once in the file. */
  find: string;
  /** The text that replaces it. */
  replace: string;
  /** Text the check's output must contain while the edit is in place. */
  output: string;
};

export type Check = {
  /** One word. `devctl ci --only <name>` runs this check alone. */
  name: string;
  /** The kind of defect the check is there to catch (M8). */
  catches: string;
  /** The command, run from the root of the checkout. Exit 0 is green. */
  run: readonly string[];
  /** The change that made it red (M3). At least one. */
  red: readonly [RedChange, ...RedChange[]];
};

const DEVCTL = ['bun', 'packages/devctl/src/index.ts'];

export const CHECKS: readonly Check[] = [
  {
    name: 'install',
    catches: 'a package.json whose pinned versions the lockfile does not hold',
    run: ['bun', 'install', '--frozen-lockfile'],
    red: [
      {
        breaks: 'a pinned version changes without the lockfile',
        file: 'packages/server/package.json',
        find: '"elysia": "1.4.30"',
        replace: '"elysia": "1.4.29"',
        output: 'lockfile had changes, but lockfile is frozen',
      },
    ],
  },
  {
    name: 'build',
    catches: 'a package that does not type-check or bundle, or is left out of the build',
    run: [...DEVCTL, 'build'],
    red: [
      {
        breaks: 'the server passes a number where Elysia takes its config',
        file: 'packages/server/src/index.ts',
        find: 'return new Elysia().use(',
        replace: 'return new Elysia(0).use(',
        output: 'packages/server/src/index.ts(21,',
      },
      {
        breaks: 'a step of the @local features passes a number where the server takes a string setting',
        file: 'features/local/version.steps.ts',
        find: 'FAIRFOX_COMMIT: commit,',
        replace: 'FAIRFOX_COMMIT: Number(commit),',
        output: 'features/local/version.steps.ts(',
      },
      {
        breaks: 'the shell is dropped from the build table',
        file: 'packages/devctl/src/build.ts',
        find: "  { name: 'shell', target: 'browser' },\n",
        replace: '',
        output: 'packages/shell is not in the build table',
      },
    ],
  },
  {
    name: 'help',
    catches: 'a command devctl --help does not list, or a command with no help (L7)',
    run: ['bun', 'packages/devctl/src/checks/help.ts'],
    red: [
      {
        breaks: 'devctl --help leaves ci out of its list',
        file: 'packages/devctl/src/commands.ts',
        find: 'const list = COMMANDS.map(',
        replace: "const list = COMMANDS.filter((c) => c.name !== 'ci').map(",
        output: 'devctl --help does not list ci',
      },
      {
        breaks: "a command's --help prints no usage line",
        file: 'packages/devctl/src/command.ts',
        find: 'return `${usage(command)}\\n\\n',
        replace: 'return `\\n\\n',
        output: 'devctl build --help prints no usage',
      },
    ],
  },
  {
    name: 'completion',
    catches: 'a zsh completion that names other commands, flags or packages than devctl has (L7)',
    run: ['bun', 'packages/devctl/src/checks/completion.ts'],
    red: [
      {
        breaks: 'the completion leaves out the command ci',
        file: 'completions/devctl.zsh',
        find: "    'ci:Run every registered check on the commit that is checked out'\n",
        replace: '',
        output: 'lacks commands: ci',
      },
      {
        breaks: 'the completion leaves out the flag --red of ci',
        file: 'completions/devctl.zsh',
        find: "        '--red[see each check red with its recorded change, then green again]' \\\n",
        replace: '',
        output: 'lacks flags of ci: red',
      },
      {
        breaks: 'the completion leaves out the package shell',
        file: 'completions/devctl.zsh',
        find: '(server client cli shell permissions devctl)',
        replace: '(server client cli permissions devctl)',
        output: 'lacks packages of build: shell',
      },
    ],
  },

  // Step 0a, the tests and the lint scripts.
  {
    name: 'no-as-casting',
    catches: 'a value whose type the code asserts with `as` and the compiler never checks',
    run: ['bun', 'packages/devctl/src/checks/no-as-casting.ts'],
    red: [
      {
        breaks: 'devctl asserts that PATH is a string',
        file: 'packages/devctl/src/proc.ts',
        find: 'const path = process.env.PATH;',
        replace: 'const path = process.env.PATH as string;',
        output: 'packages/devctl/src/proc.ts:7',
      },
      {
        breaks: "a return asserts its type, which eal's line scan let through",
        file: 'packages/devctl/src/record.ts',
        find: "  return 'write';",
        replace: "  return 'write' as RecordDecision;",
        output: 'packages/devctl/src/record.ts:36',
      },
      {
        breaks: "a cast after ), which eal's line scan let through",
        file: 'packages/devctl/src/build.ts',
        find: 'const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);',
        replace: 'const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name) as string[];',
        output: 'packages/devctl/src/build.ts:50',
      },
      {
        breaks: "an angle-bracket assertion, which eal's line scan let through",
        file: 'packages/devctl/src/record.ts',
        find: "    return 'partial';",
        replace: "    return <RecordDecision>'partial';",
        output: 'packages/devctl/src/record.ts:28',
      },
    ],
  },
  {
    name: 'no-fixed-waits',
    catches: 'a wait that guesses how long an operation takes, instead of waiting on a signal',
    run: ['bun', 'packages/devctl/src/checks/no-fixed-waits.ts'],
    red: [
      {
        breaks: 'ci --red sleeps after it writes the changed file',
        file: 'packages/devctl/src/ci.ts',
        find: '  await Bun.write(path, original.replace(change.find, change.replace));\n',
        replace:
          '  await Bun.write(path, original.replace(change.find, change.replace));\n  await new Promise((r) => setTimeout(r, 100));\n',
        output: 'packages/devctl/src/ci.ts:102  [a timer that resolves a promise]',
      },
      {
        breaks: "ci --red waits on setTimeout(() => resolve(), 100), which eal's line scan let through",
        file: 'packages/devctl/src/ci.ts',
        find: '  await Bun.write(path, original.replace(change.find, change.replace));\n',
        replace:
          '  await Bun.write(path, original.replace(change.find, change.replace));\n  await new Promise<void>((resolve) => {\n    setTimeout(() => resolve(), 100);\n  });\n',
        output: 'packages/devctl/src/ci.ts:103  [a timer that resolves a promise]',
      },
      {
        breaks: "devctl imports setTimeout from node:timers/promises, which eal's line scan let through",
        file: 'packages/devctl/src/proc.ts',
        find: '/**\n * The environment every child process gets',
        replace: "import { setTimeout } from 'node:timers/promises';\n/**\n * The environment every child process gets",
        output: 'packages/devctl/src/proc.ts:1  [a sleep imported from bun or timers/promises]',
      },
      {
        breaks: "every child process waits on a destructured Bun.sleep, which eal's line scan let through",
        file: 'packages/devctl/src/proc.ts',
        find: '  const started = performance.now();\n',
        replace: '  const { sleep } = Bun;\n  await sleep(50);\n  const started = performance.now();\n',
        output: 'packages/devctl/src/proc.ts:25  [Bun.sleep, destructured]',
      },
    ],
  },
  {
    name: 'unit',
    catches: 'a wrong result from one function',
    run: ['bun', 'test', './packages', '--path-ignore-patterns=**/*.property.test.ts'],
    red: [
      {
        breaks: 'ci writes its record when the tree changed during the run',
        file: 'packages/devctl/src/record.ts',
        find: '!run.cleanBefore || !run.cleanAfter ||',
        replace: '!run.cleanBefore ||',
        output: '(fail) the ci record > a tree changed during the run writes none',
      },
      {
        breaks: 'findCasts takes the as of a mapped type for a cast',
        file: 'packages/devctl/src/checks/casts.ts',
        find: '  walk(source, (node) => {\n',
        replace:
          "  walk(source, (node) => {\n    if (ts.isMappedTypeNode(node) && node.nameType !== undefined) {\n      found.push(finding(source, node, 'type assertion'));\n    }\n",
        output: '(fail) findCasts > leaves the as of a mapped type',
      },
      {
        breaks: 'findFixedWaits takes a string that names Bun.sleep for a wait',
        file: 'packages/devctl/src/checks/waits.ts',
        find: '    if (isBunSleep(node)) {\n',
        replace: "    if (ts.isStringLiteralLike(node) && node.text.includes('Bun.sleep(')) {\n      report(node, 'Bun.sleep');\n    } else if (isBunSleep(node)) {\n",
        output: '(fail) findFixedWaits > leaves a string that names a wait',
      },
      {
        breaks: 'the CLI prints whatever the server answers as the commit, undefined included',
        file: 'packages/cli/src/version.ts',
        find: 'export function commitOf(answer: unknown): string {\n',
        replace: "export function commitOf(answer: unknown): string {\n  return String(Reflect.get(Object(answer), 'commit'));\n",
        output: '(fail) the commit in a version answer > an answer with no commit is refused',
      },
    ],
  },
  {
    name: 'property',
    catches: 'a defect that only some inputs show (L6)',
    run: ['bun', 'test', '.property.test.ts'],
    red: [
      {
        breaks: 'entries drops the first action of each kind',
        file: 'packages/permissions/src/index.ts',
        find: 'actions.map((action)',
        replace: 'actions.slice(1).map((action)',
        output: '(fail) entries > a list has one entry for each of its actions',
      },
    ],
  },
  {
    name: 'local',
    catches: 'behaviour that does not match the requirement, in the @local scenarios of the .feature files (M1)',
    run: ['bun', 'test', './features/local'],
    red: [
      {
        breaks: 'the version route answers a second field',
        file: 'packages/server/src/index.ts',
        find: "get('/version', () => ({ commit }))",
        replace: "get('/version', () => ({ commit, server: 'fairfox' }))",
        output: 'Step failed in "The client reads the commit the server runs (commit: 3f9c2e1)": And the answer holds nothing but the commit',
      },
      {
        breaks: 'the version route answers a header that names the database',
        file: 'packages/server/src/index.ts',
        find: "get('/version', () => ({ commit }))",
        replace: "get('/version', ({ set }) => {\n    set.headers['x-database-path'] = ':memory:';\n    return { commit };\n  })",
        output: 'Step failed in "The client reads the commit the server runs (commit: 3f9c2e1)": And the answer holds nothing but the commit',
      },
      {
        breaks: 'the CLI prints a fixed value',
        file: 'packages/cli/src/index.ts',
        find: 'console.log(commitOf(answer.data));',
        replace: "console.log('0000000');",
        output: 'Step failed in "The CLI prints the commit the server runs (commit: 3f9c2e1)": Then the CLI prints the commit "3f9c2e1"',
      },
      {
        breaks: 'the route answers a commit typed into its code',
        file: 'packages/server/src/index.ts',
        find: "get('/version', () => ({ commit }))",
        replace: "get('/version', () => ({ commit: '3f9c2e1' }))",
        output: 'Step failed in "The client reads the commit the server runs (commit: a07b5d4)": Then the answer is the commit "a07b5d4"',
      },
      {
        breaks: 'the CLI prints a commit typed into its code',
        file: 'packages/cli/src/index.ts',
        find: 'console.log(commitOf(answer.data));',
        replace: "console.log('3f9c2e1');",
        output: 'Step failed in "The CLI prints the commit the server runs (commit: a07b5d4)": Then the CLI prints the commit "a07b5d4"',
      },
      {
        breaks: 'the commit setting gets a default',
        file: 'packages/server/src/config.ts',
        find: 'commit: required(settings, SETTINGS.commit),',
        replace: "commit: settings[SETTINGS.commit] ?? 'unknown',",
        output: 'Step failed in "A server with no commit set does not start": Then the server does not start',
      },
      {
        breaks: 'the runner reads the top level of features/ only',
        file: 'features/local/gherkin.ts',
        find: "readdirSync(dir, { recursive: true, encoding: 'utf8' })",
        replace: "readdirSync(dir, { encoding: 'utf8' })",
        output: '(fail) the feature runner > reads .feature files at every depth',
      },
      {
        breaks: 'a scenario with no location tag, such as @Local, is left out without a word',
        file: 'features/local/gherkin.ts',
        find: 'if (!pickle.tags.some((t) => LOCATIONS.includes(t.name))) {',
        replace: 'if (false) {',
        output: '(fail) the feature runner > a scenario tagged @Local runs nowhere, and is named',
      },
    ],
  },
  {
    name: 'mutation',
    catches: 'a test that passes when the code is wrong (L6, "test gaps"): Stryker on each package this branch touched',
    run: [...DEVCTL, 'mutation', '--since', 'main'],
    red: [
      {
        breaks: 'the test that each entry is an action its kind allows asserts nothing',
        file: 'packages/permissions/src/index.property.test.ts',
        find: '          expect(list[entry.kind]).toContain(entry.action);\n',
        replace: '',
        output: '[Survived] ObjectLiteral',
      },
      {
        breaks: 'the test of a one-character answer is gone from the cli package',
        file: 'packages/cli/src/version.test.ts',
        find: "    expect(() => commitOf('x')).toThrow(refused);\n",
        replace: '',
        output: 'packages/cli/src/version.ts:9:5',
      },
      {
        breaks: 'a touched package with no Stryker config and no reason passes',
        file: 'packages/devctl/src/mutation.ts',
        find: "  shell: 'no code yet: the shell is built at step 7b',\n",
        replace: '',
        output: 'packages/shell changed since main and has no Stryker config',
      },
    ],
  },
];
