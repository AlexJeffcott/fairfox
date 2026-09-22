// The @browser features (M1): Playwright with its BDD plug-in, in WebKit, on
// a screen 320px wide (U1). `devctl browser` runs it; see
// packages/devctl/src/browser.ts.
//
// Only @browser scenarios are generated. The @local features sit in the same
// features/ directory and run under Bun, not here; their steps are not in the
// `steps` glob below, and playwright-bdd leaves a feature out when its tags do
// not match.
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { PHONE, WIDTH } from './features/browser/phone.ts';

const testDir = defineBddConfig({
  features: 'features/*.feature',
  steps: 'features/browser/*.ts',
  tags: '@browser',
  outputDir: '.features-gen',
});

export default defineConfig({
  testDir,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  // Each scenario has its own context and its own test server, so they may run at once.
  fullyParallel: true,
  projects: [{ name: `webkit-${WIDTH}`, use: { browserName: 'webkit', ...PHONE } }],
});
