import type { Command } from './command.ts';
import { streamEach } from './stream.ts';

const PLAYWRIGHT = ['bun', 'node_modules/@playwright/test/cli.js'];

/**
 * The steps of `devctl browser`, in order. Playwright and playwright-bdd run
 * under Bun, named the long way: `bunx playwright` would run the workers under
 * Node, and the test server in the steps is `Bun.serve`.
 */
const STEPS: readonly (readonly string[])[] = [
  ['bun', 'packages/devctl/src/index.ts', 'build', 'shell'],
  ['bun', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'features/browser/tsconfig.json'],
  // Downloads the WebKit this Playwright pins when it is missing; does nothing when it is there.
  [...PLAYWRIGHT, 'install', 'webkit'],
  ['bun', 'node_modules/playwright-bdd/dist/cli/index.js'],
  [...PLAYWRIGHT, 'test'],
];

export const browser: Command = {
  name: 'browser',
  summary: 'Run the @browser features in WebKit on a screen 320px wide',
  args: '',
  help: `
Run the @browser features (M1) in a real browser: WebKit, on a screen 320px
wide (U1). In order: build the shell, type-check the steps in
features/browser/, install the WebKit that the pinned Playwright names when
it is missing, generate a spec from each feature in features/ with
playwright-bdd, and run them with Playwright.

Only scenarios tagged @browser run. The @local features in the same
directory run under Bun and are left out. A test server, started by the
steps, serves the built shell from packages/shell/dist/.

The config is playwright.config.ts; the screen is features/browser/phone.ts.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl browser takes no arguments');
      return 1;
    }
    return streamEach(STEPS, root);
  },
};
