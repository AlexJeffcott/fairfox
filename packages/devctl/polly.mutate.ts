// Mutation testing of devctl: `devctl mutation devctl`. It mutates the pure
// functions its tests call and leaves out the rest: the command flow, the
// check scripts and the thin wrappers around docker and fly, which run as
// processes. devctl ci --red sees each check red (M3), and devctl deploy and
// rollback are never run in CI.
import { defineMutation } from '@fairfox/polly/mutate';

export default defineMutation({
  targets: [
    'src/checks/casts.ts',
    'src/checks/syntax.ts',
    'src/checks/waits.ts',
    'src/deploy-decisions.ts',
    'src/env-list.ts',
    'src/fly-config.ts',
    'src/image-contents.ts',
    'src/record.ts',
    'src/releases.ts',
    'src/restore-decisions.ts',
    'src/rollback-decisions.ts',
    'src/version-answer.ts',
  ],
  tests: { include: ['src/**/*.test.ts'] },
  thresholds: { break: 100 },
});
