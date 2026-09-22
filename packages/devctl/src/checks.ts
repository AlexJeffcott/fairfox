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
];
