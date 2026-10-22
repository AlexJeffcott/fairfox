// Mutation testing of the shell: `devctl mutation shell`. Its tests are the
// @browser feature, in WebKit, which a Bun preload cannot reach. The command
// runner runs packages/devctl/src/mutation-shell.ts for each mutant: it
// builds the shell with the mutant in it and runs the feature. The command
// builds into packages/shell/dist/, one mutant at a time.
import { defineMutation } from '@fairfox/polly/mutate';

export default defineMutation({
  targets: ['src/**/*.ts'],
  runner: { kind: 'command', argv: ['bun', '../devctl/src/mutation-shell.ts'] },
  concurrency: 1,
  thresholds: { break: 100 },
});
