// Mutation testing of the cli package: `devctl mutation cli`. It leaves out
// src/index.ts, the command flow, which the @local features run as a process.
import { defineMutation } from '@fairfox/polly/mutate';

export default defineMutation({
  targets: ['src/**/*.ts', '!src/**/*.test.ts', '!src/index.ts'],
  tests: { include: ['src/**/*.test.ts'] },
  thresholds: { break: 100 },
});
