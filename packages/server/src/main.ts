/**
 * The entry point of the server in the production image: `bun
 * packages/server/src/main.ts`, run by Litestream from packages/server/serve.sh
 * (S7a). It reads its settings from the environment (C2), and does not start
 * when one is missing (C1). It prints one line once it listens; `devctl image`
 * reads that line, then reads the version route (IM1).
 */
import { readPort } from './config.ts';
import { environment } from './environment.ts';
import { createApp } from './index.ts';

const settings = environment();
const port = readPort(settings);
const app = createApp(settings).listen({ hostname: '0.0.0.0', port });
console.log(`Fairfox listening on port ${port}`);

// Litestream forwards SIGTERM. Stop the server, which closes the database, and exit.
process.on('SIGTERM', async () => {
  await app.stop();
  process.exit(0);
});
