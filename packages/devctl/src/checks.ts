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
        output: 'packages/server/src/index.ts(23,',
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
        output: 'packages/devctl/src/build.ts:51',
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
        output: 'the page is 408px wide and scrolls sideways',
      },
      {
        breaks: 'the shell draws the name 400px wide inside a box that clips it, so the page does not scroll',
        file: 'packages/shell/src/index.ts',
        find: "h('h1', null, name)",
        replace: "h('div', { style: 'overflow: hidden' }, h('h1', { style: 'width: 400px' }, name))",
        output: '<h1> ends at 408px',
      },
      {
        breaks: 'the script of the shell throws, once it has drawn the name and before its mark',
        file: 'packages/shell/src/index.ts',
        find: "  document.documentElement.dataset.shell = 'drawn';\n});\n",
        replace: "  document.documentElement.dataset.shell = 'drawn';\n});\nthrow new Error('the shell threw');\n",
        output: 'page error: the shell threw',
      },
      {
        breaks: 'the name is typed into the static HTML',
        file: 'packages/shell/src/index.html',
        find: '<body></body>',
        replace: '<body>Fairfox</body>',
        output: 'the name Fairfox is shown with scripts turned off',
      },
      {
        breaks: 'the features glob misses the feature file',
        file: 'playwright.config.ts',
        find: "  features: 'features/**/*.feature',",
        replace: "  features: 'features/*/**/*.feature',",
        output: 'Error: No tests found',
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
      {
        breaks: 'the cfg names no invariant, so TLC checks nothing but deadlock',
        file: 'specs/tla/two-writers/TwoWriters.cfg',
        find: 'INVARIANTS TypeOK NoLostUpdate\n',
        replace: '',
        output: 'TwoWriters.cfg names no INVARIANT',
      },
      {
        breaks: 'a spec has no cfg beside it (the specs are read from a fixture that holds one)',
        file: 'packages/devctl/src/tlc.ts',
        find: "const SPECS = join('specs', 'tla');",
        replace: "const SPECS = join('packages', 'devctl', 'fixtures', 'tla');",
        output: 'Orphan.tla has no Orphan.cfg beside it',
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
      {
        breaks: 'TLC samples behaviours instead of checking every state, and polly calls it passed',
        file: 'packages/devctl/polly-tla/entrypoint.sh',
        find: 'java -XX:+UseParallelGC -jar /opt/tla2tools.jar "$@" > /work/tlc.log',
        replace: 'java -XX:+UseParallelGC -jar /opt/tla2tools.jar -simulate num=20 "$@" > /work/tlc.log',
        output: 'TLC did not print "Model checking completed. No error has been found."',
      },
      {
        breaks: 'polly runs TLC in an image that is not the one devctl verify built',
        file: 'packages/devctl/polly-tla/entrypoint.sh',
        find: 'if [ ! -e /work/.keep-tlc-log ]; then',
        replace: 'if true; then',
        output: 'polly did not run TLC in the polly-tla:latest devctl verify built',
      },
      {
        breaks: 'an anchored route is added, and messages.include leaves it out of the model',
        file: 'packages/server/src/turns.ts',
        find: '  return { taken: turns.value.taken };\n});\n',
        replace:
          "  return { taken: turns.value.taken };\n}).post('/reset', () => {\n  ensures(turns.value.taken >= 0, 'the count is never negative');\n  return {};\n});\n",
        output: 'Anchored routes missing from messages.include in packages/server/specs/verification.config.ts: POST /reset.',
      },
      {
        breaks: 'messages.include names a route that has no anchors',
        file: 'packages/server/specs/verification.config.ts',
        find: "    include: ['POST /turn'],",
        replace: "    include: ['POST /turn', 'POST /reset'],",
        output: 'Names in messages.include with no anchored route in packages/server/src: POST /reset.',
      },
      {
        breaks: 'the jar for polly-tla is not the tla2tools.jar the checkout pins',
        file: 'packages/devctl/src/tlc.ts',
        find: "sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'",
        replace: "sha256: '0000000000000000000000000000000000000000000000000000000000000000'",
        output: 'not the pinned 0000000000000000000000000000000000000000000000000000000000000000',
      },
    ],
  },
  // The production image: what production runs, and no development tool (C7); and the server runs in it (IM1).
  {
    name: 'image',
    catches:
      "a development tool in the production image, or a production image the server cannot start in. It is the image a deploy sends to Fly, and a tool that is not in it cannot stop it from building (C7): Stryker stopped eal's, June to 2026-08-25 (L6). The server is started in it with the settings of fly.toml and its version route read (IM1): --omit=peer built green and the server could not start",
    run: [...DEVCTL, 'image'],
    red: [
      {
        breaks: 'the image has no command: the CMD is dropped from the Dockerfile',
        file: 'Dockerfile',
        find: 'CMD ["/app/packages/server/serve.sh"]\n',
        replace: '',
        output: 'did not start: the container exited (',
      },
      {
        breaks: 'the server listens on the port after the one fly.toml names',
        file: 'packages/server/src/main.ts',
        find: ".listen({ hostname: '0.0.0.0', port });",
        replace: ".listen({ hostname: '0.0.0.0', port: port + 1 });",
        output: 'No answer from the server in fairfox:',
      },
      {
        breaks: 'the entry point exits at once',
        file: 'packages/server/src/main.ts',
        find: 'const settings = environment();\n',
        replace: 'process.exit(0);\nconst settings = environment();\n',
        output: 'did not start: the container exited (',
      },
      {
        breaks: 'the server answers a commit typed into its code, not the one the image was started with',
        file: 'packages/server/src/index.ts',
        find: "get('/version', () => ({ commit }))",
        replace: "get('/version', () => ({ commit: '3f9c2e1' }))",
        output: 'the version route answered the commit 3f9c2e1, not ',
      },
      {
        breaks: 'fly.toml no longer gives the server its database path, and serve.sh stops',
        file: 'fly.toml',
        find: '  FAIRFOX_DATABASE_PATH = "/data/fairfox.db"\n',
        replace: '',
        output: 'The setting FAIRFOX_DATABASE_PATH is not set. It has no default.',
      },
      {
        breaks: 'fly.toml gives the server a port that is not the one Fly reaches it on',
        file: 'fly.toml',
        find: '  FAIRFOX_PORT = "3000"\n',
        replace: '  FAIRFOX_PORT = "3001"\n',
        output: 'fly.toml [env] FAIRFOX_PORT is "3001" and internal_port is 3000',
      },
      {
        breaks: 'a postinstall script sets up git hooks, and the image has no git',
        file: 'package.json',
        find: '  "scripts": {\n',
        replace: '  "scripts": {\n    "postinstall": "git config core.hooksPath .githooks",\n',
        output: 'postinstall script from "fairfox" exited with 127',
      },
      {
        breaks: "the image is built for the developer's machine, arm64, not for Fly's amd64",
        file: 'packages/devctl/src/image.ts',
        find: "'docker', 'build', '--progress', 'plain', '--platform', FLY_PLATFORM,",
        replace: "'docker', 'build', '--progress', 'plain',",
        output: "is for linux/arm64, and Fly's machines run linux/amd64",
      },
      {
        breaks: "the shell is installed into the image, and polly's development toolchain with it",
        file: '.dockerignore',
        find: 'packages/shell\npackages/client',
        replace: 'packages/client',
        output: 'ts-morph',
      },
      {
        breaks: 'the type-only packages are left in the image, TypeScript among them',
        file: 'Dockerfile',
        find: 'rm -rf node_modules/.bun/typescript@*',
        replace: 'rm -rf node_modules/.bun/no-such-package@*',
        output: 'typescript',
      },
      {
        breaks: 'the table names a package the image does not hold',
        file: 'packages/devctl/src/image-contents.ts',
        find: "  ms: 'debug',\n",
        replace: "  ms: 'debug',\n  'ts-morph': 'nothing pulls it in: it is here to be seen red',\n",
        output: 'IMAGE_PACKAGES names packages the image does not hold: ts-morph.',
      },
    ],
  },
  // Litestream, end to end: replicate from the image, restore, read the marker and the migration back (S7, S7a).
  {
    name: 'replica',
    catches:
      'a backup pipeline that does not bring the database back: a replica Litestream does not write, a restore that is not the database that was set up, a replica older than one hour, a boot on an empty volume that does not restore first (S7, S7a, TG2). Runs on the image the image check built',
    run: [...DEVCTL, 'replica'],
    red: [
      {
        breaks: 'the restore is made from an empty replica (M3): it restores nothing, and must not pass',
        file: 'packages/devctl/src/replica.ts',
        find: "const restored = await restoreFrom(root, tag, join(dir, 'replica'));",
        replace: "const restored = await restoreFrom(root, tag, join(dir, 'empty'));",
        output: 'no matching backup files available',
      },
      {
        breaks: 'the marker row is not written at set-up, so the restored database cannot be told from a fresh one',
        file: 'packages/server/src/migrations/001-meta.ts',
        find: "    database.query('INSERT INTO meta (key, value) VALUES (?, ?)').run('marker', setup.marker);\n",
        replace: '',
        output: 'The meta table holds no marker row, or no migration row: the database is not set up.',
      },
      {
        breaks: 'the restored database is compared with a marker that is not the live one',
        file: 'packages/devctl/src/replica.ts',
        find: 'const problems = restoreProblems(made.live, restored, LATEST_MIGRATION);',
        replace: "const problems = restoreProblems({ ...made.live, marker: 'another' }, restored, LATEST_MIGRATION);",
        output: 'and the live one another.',
      },
      {
        breaks: 'the latest migration this image knows is not the one the restored database is at',
        file: 'packages/devctl/src/replica.ts',
        find: 'const problems = restoreProblems(made.live, restored, LATEST_MIGRATION);',
        replace: "const problems = restoreProblems(made.live, restored, '002-members');",
        output: 'The restored database is at migration 001-meta, and the latest is 002-members.',
      },
      {
        breaks: 'a replica of any age is too old: the status command fails on the age it reads (S7a)',
        file: 'packages/server/src/replica.ts',
        find: 'export const MAX_REPLICA_AGE_SECONDS = 3600;',
        replace: 'export const MAX_REPLICA_AGE_SECONDS = -1;',
        output: 's old, older than -1 s.',
      },
      {
        breaks: 'serve.sh runs the server without Litestream, so no snapshot is ever written',
        file: 'packages/server/serve.sh',
        find: 'exec litestream replicate -restore-if-db-not-exists -exec "bun packages/server/src/main.ts" "$FAIRFOX_DATABASE_PATH" "$FAIRFOX_REPLICA_URL"',
        replace: 'exec bun packages/server/src/main.ts',
        output: '"snapshot complete" did not appear inside',
      },
      {
        breaks: 'serve.sh does not ask Litestream to restore, so a boot on an empty volume makes a fresh database (TG2)',
        file: 'packages/server/serve.sh',
        find: 'exec litestream replicate -restore-if-db-not-exists -exec',
        replace: 'exec litestream replicate -exec',
        output: '"restore completed" did not appear inside',
      },
      {
        breaks: 'the second boot keeps the old database directory, so nothing is restored and the check proves nothing about an empty volume',
        file: 'packages/devctl/src/replica.ts',
        find: "  await rm(join(dir, 'data'), { recursive: true, force: true });\n  await mkdir(join(dir, 'data'));\n  await serveWith(root, tag, commit, dir, [RESTORED_ON_BOOT]);",
        replace: '  await serveWith(root, tag, commit, dir, [RESTORED_ON_BOOT]);',
        output: '"restore completed" did not appear inside',
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
  // The deploy document names every variable the server reads (C3).
  {
    name: 'env-list',
    catches: 'a variable the server reads that DEPLOY.md does not list, or one DEPLOY.md lists that nothing reads (C3)',
    run: ['bun', 'packages/devctl/src/checks/env-list.ts'],
    red: [
      {
        breaks: 'DEPLOY.md lists a variable nothing reads',
        file: 'DEPLOY.md',
        find: '| `FAIRFOX_REPLICA_URL` |',
        replace: '| `FAIRFOX_EXTRA` | nothing | nowhere |\n| `FAIRFOX_REPLICA_URL` |',
        output: 'DEPLOY.md lists FAIRFOX_EXTRA under "Every setting the code reads (C3)", and nothing in packages/server/ reads it.',
      },
      {
        breaks: 'the SETTINGS table names a variable DEPLOY.md does not list',
        file: 'packages/server/src/config.ts',
        find: "  replicaUrl: 'FAIRFOX_REPLICA_URL',\n",
        replace: "  replicaUrl: 'FAIRFOX_REPLICA_URL',\n  extra: 'FAIRFOX_EXTRA',\n",
        output: 'packages/server/ reads FAIRFOX_EXTRA, and DEPLOY.md does not list it',
      },
      {
        breaks: 'a file of the server reads process.env.FAIRFOX_LOG, which is in no table',
        file: 'packages/server/src/environment.ts',
        find: '  return process.env;',
        replace: '  return { ...process.env, FAIRFOX_LOG: process.env.FAIRFOX_LOG };',
        output: 'packages/server/ reads FAIRFOX_LOG, and DEPLOY.md does not list it',
      },
      {
        breaks: 'serve.sh reads a variable DEPLOY.md does not list',
        file: 'packages/server/serve.sh',
        find: 'set -eu\n',
        replace: 'set -eu\n: "${FAIRFOX_BUCKET:?The setting FAIRFOX_BUCKET is not set.}"\n',
        output: 'packages/server/ reads FAIRFOX_BUCKET, and DEPLOY.md does not list it',
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
        replace: "    if (ts.isStringLiteralLike(node) && node.text.includes('Bun.sleep(')) {\n      found.set(node, 'Bun.sleep');\n    }\n    if (isBunSleep(node)) {\n",
        output: '(fail) findFixedWaits > leaves a string that names a wait',
      },
      {
        breaks: 'the CLI prints whatever the server answers as the commit, undefined included',
        file: 'packages/cli/src/version.ts',
        find: 'export function commitOf(answer: unknown): string {\n',
        replace: "export function commitOf(answer: unknown): string {\n  return String(Reflect.get(Object(answer), 'commit'));\n",
        output: '(fail) the commit in a version answer > an answer with no commit is refused',
      },
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
      {
        breaks: 'a database at a migration this image does not know runs every migration again',
        file: 'packages/server/src/migrations/plan.ts',
        find: '  if (at < 0) {\n    return { ahead: applied };\n  }\n',
        replace: '',
        output: '(fail) the migration plan > a database at a migration this image does not know is ahead, and runs none',
      },
      {
        breaks: 'a replica over the limit passes',
        file: 'packages/server/src/replica.ts',
        find: '  if (ageSeconds > maxSeconds) {',
        replace: '  if (ageSeconds > maxSeconds * 2) {',
        output: '(fail) the verdict on the replica > a replica over the limit fails, and the message says by how much',
      },
      {
        breaks: 'a deploy from a tree with changes is not refused',
        file: 'packages/devctl/src/deploy-decisions.ts',
        find: '  if (!facts.clean) {',
        replace: '  if (facts.clean && !facts.clean) {',
        output: '(fail) may it deploy > a tree with changes may not',
      },
      {
        breaks: "a rollback to the old app's release, older than the first of the new server, is not refused",
        file: 'packages/devctl/src/rollback-decisions.ts',
        find: '  if (to.version < first.version) {',
        replace: '  if (to.version < 0) {',
        output: "(fail) which release to go back to > the old app's release, older than the first of the new server, is refused (C6)",
      },
      {
        breaks: 'a version answer with a second field passes',
        file: 'packages/devctl/src/version-answer.ts',
        find: "  if (keys.length !== 1 || typeof answered !== 'string') {",
        replace: "  if (typeof answered !== 'string') {",
        output: '(fail) the verdict on a version answer > a second field fails',
      },
    ],
  },
  {
    name: 'property',
    catches: 'a defect that only some inputs show (L6)',
    run: ['bun', 'test', '.property.test.ts'],
    red: [
      {
        breaks: 'ci writes its record when two or more checks are red; one red check still stops it',
        file: 'packages/devctl/src/record.ts',
        find: 'if (run.red > 0) {',
        replace: 'if (run.red === 1) {',
        output: '(fail) the ci record > is written only for a full run with no red check, on one clean commit',
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
        breaks: 'the test of self.setTimeout is gone from devctl',
        file: 'packages/devctl/src/checks/waits.test.ts',
        find: "  ['self.setTimeout resolving a promise', 'await new Promise((go) => self.setTimeout(go, 100));', [TIMER]],\n",
        replace: '',
        output: 'packages/devctl/src/checks/waits.ts:7:60',
      },
      {
        breaks: 'the test of an empty setting is gone from the server',
        file: 'packages/server/src/config.test.ts',
        find: "    expect(() => readConfig({ FAIRFOX_COMMIT: '', FAIRFOX_DATABASE_PATH: ':memory:' })).toThrow(\n      'The setting FAIRFOX_COMMIT is not set',\n    );\n",
        replace: '',
        output: 'packages/server/src/config.ts:29:30',
      },
      {
        breaks: 'the test of a one-character answer is gone from the cli package',
        file: 'packages/cli/src/version.test.ts',
        find: "    expect(() => commitOf('x')).toThrow(refused);\n",
        replace: '',
        output: 'packages/cli/src/version.ts:9:5',
      },
      {
        breaks: "the test of the turn route's answers is gone: return {} survives",
        file: 'packages/server/src/turns.test.ts',
        find: "test('each answer says how many turns are taken', async () => {\n  const answers = [await takeTurn(), await takeTurn(), await takeTurn()];\n  expect(answers).toEqual([\n    { status: 200, body: { taken: 1 } },\n    { status: 409, body: { taken: 1 } },\n    { status: 409, body: { taken: 1 } },\n  ]);\n});\n",
        replace: '',
        output: 'packages/server/src/turns.ts:32:10',
      },
      {
        breaks: 'a touched package with no Stryker config and no reason passes',
        file: 'packages/devctl/src/mutation.ts',
        find: '  client: "no logic of its own: createClient is one call to Eden\'s treaty",\n',
        replace: '',
        output: 'packages/client changed since main and has no Stryker config',
      },
      {
        breaks: 'the shell page is not given the active mutant, so no shell mutant is ever tried',
        file: 'packages/devctl/src/mutation-shell.ts',
        find: 'activeMutant: ${JSON.stringify(mutant)}',
        replace: 'activeMutant: ""',
        output: 'packages/shell/src/index.ts:8:21',
      },
    ],
  },
];
