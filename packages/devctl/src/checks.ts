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
        find: 'return new Elysia();',
        replace: 'return new Elysia(0);',
        output: 'packages/server/src/index.ts(5,',
      },
      {
        breaks: 'the shell is dropped from the build table',
        file: 'packages/devctl/src/build.ts',
        find: "  { name: 'shell', target: 'browser', page: true },\n",
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
  // The screens: Preact, Signals and polly, each pinned to one version (M12).
  {
    name: 'pins',
    catches: 'a framework of the screens given as a range, or a second copy of it installed (M12)',
    run: ['bun', 'packages/devctl/src/checks/pins.ts'],
    red: [
      {
        breaks: 'the shell gives Preact as a range',
        file: 'packages/shell/package.json',
        find: '"preact": "10.29.1"',
        replace: '"preact": "^10.29.1"',
        output: 'gives preact as ^10.29.1, not one exact version',
      },
      {
        breaks: 'the lockfile holds a second Preact, under polly',
        file: 'bun.lock',
        find: '    "preact": ["preact@10.29.1"',
        replace: '    "@fairfox/polly/preact": ["preact@10.29.8", "", {}, ""],\n    "preact": ["preact@10.29.1"',
        output: 'bun.lock holds 2 copies of preact: 10.29.8, 10.29.1',
      },
    ],
  },
  // The @browser features: Playwright with playwright-bdd, in WebKit at 320px wide (U1).
  {
    name: 'browser',
    catches: 'a screen that fails in a real browser or at the width of a phone (L2)',
    run: [...DEVCTL, 'browser'],
    red: [
      {
        breaks: 'the shell draws an element 400px wide',
        file: 'packages/shell/src/index.ts',
        find: "h('h1', null, name)",
        replace: "h('h1', { style: 'width: 400px' }, name)",
        output: 'on a screen 320px wide: it scrolls sideways',
      },
      {
        breaks: 'the script of the shell throws, once it has drawn the name',
        file: 'packages/shell/src/index.ts',
        find: 'document.body);',
        replace: "document.body);\nthrow new Error('the shell threw');",
        output: 'page error: the shell threw',
      },
      {
        breaks: 'the name is typed into the static HTML',
        file: 'packages/shell/src/index.html',
        find: '<body></body>',
        replace: '<body>Fairfox</body>',
        output: 'the name Fairfox is shown with scripts turned off',
      },
    ],
  },
  // TLC, for the hand-written TLA+ specs (S4).
  {
    name: 'tlc',
    catches: 'a defect of ordering or convergence in a hand-written TLA+ spec (S4, L4)',
    run: [...DEVCTL, 'tlc'],
    red: [
      {
        breaks: 'the writers read the count without taking the lock',
        file: 'specs/tla/two-writers/TwoWriters.tla',
        find: '  /\\ lock = "free"\n  /\\ lock\' = w\n',
        replace: '  /\\ UNCHANGED lock\n',
        output: 'Invariant NoLostUpdate is violated',
      },
      {
        breaks: 'the jar on disk is not the tla2tools.jar the checkout pins',
        file: 'packages/devctl/src/tlc.ts',
        find: "sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'",
        replace: "sha256: '0000000000000000000000000000000000000000000000000000000000000000'",
        output: 'not the pinned 0000000000000000000000000000000000000000000000000000000000000000',
      },
    ],
  },
  // polly verify, with the spec anchors in the handlers and the TLA+ it generates.
  {
    name: 'verify',
    catches:
      'a state that a set of handlers can reach and that breaks a rule written beside them. It checks the model polly builds from the anchors, not the code; the unit check tests the code',
    run: [...DEVCTL, 'verify'],
    red: [
      {
        breaks: 'the handler takes a turn without its guard',
        file: 'packages/server/src/turns.ts',
        find: "  requires(turns.value.taken < 1, 'a second turn is refused');\n",
        replace: '',
        output: 'Action property EnsuresAfter_HandlePostTurn is violated',
      },
      {
        breaks: 'the run does not finish inside its time limit',
        file: 'packages/devctl/src/verify.ts',
        find: 'export const LIMIT_SECONDS = 120;',
        replace: 'export const LIMIT_SECONDS = 1;',
        output: 'polly verify did not finish inside its time limit of 1 s',
      },
    ],
  },
  // The production image, built with every development tool in the tree (C7).
  {
    name: 'image',
    catches: 'a development tool that stops the production build. Stryker did, from June to 2026-08-25 (L6)',
    run: [...DEVCTL, 'image'],
    red: [
      {
        breaks: 'a postinstall script sets up git hooks, and the image has no git',
        file: 'package.json',
        find: '  "scripts": {\n',
        replace: '  "scripts": {\n    "postinstall": "git config core.hooksPath .githooks",\n',
        output: 'postinstall script from "fairfox" exited with 127',
      },
    ],
  },
  // What the server ships with.
  {
    name: 'server-deps',
    catches: 'a runtime dependency of the server that its running code never imports, shipped to production for nothing',
    run: ['bun', 'packages/devctl/src/checks/server-deps.ts'],
    red: [
      {
        breaks: 'polly is a runtime dependency of the server again',
        file: 'packages/server/package.json',
        find: '  "dependencies": {\n    "elysia": "1.4.30"\n  },',
        replace: '  "dependencies": {\n    "@fairfox/polly": "0.82.1",\n    "elysia": "1.4.30"\n  },',
        output: 'lists @fairfox/polly in dependencies',
      },
    ],
  },
  // The unit tests, under bun test. The same name and command as the unit
  // check of the branch rebuild-local: at the merge the two become one entry.
  {
    name: 'unit',
    catches: 'a wrong result from one function',
    run: ['bun', 'test', './packages', '--path-ignore-patterns=**/*.property.test.ts'],
    red: [
      {
        breaks: "the turn route takes a turn on every call: only polly's anchor refuses a second",
        file: 'packages/server/src/turns.ts',
        find: '  if (turns.value.taken >= 1) {\n    return status(409, { taken: turns.value.taken });\n  }\n',
        replace: '',
        output: '"taken": 3',
      },
      {
        breaks: 'the turn route writes its turn twice in one call; polly models the two writes as one',
        file: 'packages/server/src/turns.ts',
        find: '  turns.value = { taken: turns.value.taken + 1 };\n',
        replace: '  turns.value = { taken: turns.value.taken + 1 };\n  turns.value = { taken: turns.value.taken + 1 };\n',
        output: '"taken": 2',
      },
    ],
  },
];
