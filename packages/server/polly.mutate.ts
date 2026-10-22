// Mutation testing of the server: `devctl mutation server`. Its tests are its
// own and the @local features, which run the server in their process. It
// leaves out main.ts, status.ts and environment.ts, the two entry points and
// the one function that reads process.env. They run as processes in the
// image: devctl image and devctl replica see them red (M3).
import { defineMutation } from '@fairfox/polly/mutate';

export default defineMutation({
  targets: ['src/**/*.ts', '!src/**/*.test.ts', '!src/main.ts', '!src/status.ts', '!src/environment.ts'],
  tests: { include: ['src/**/*.test.ts', '../../features/local/**/*.test.ts'] },
  thresholds: { break: 100 },
});
