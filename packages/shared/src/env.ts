// Environment configuration for the fairfox server. Under the meshState
// architecture the server is a stateless signaling relay + cron host +
// LLM proxy. DATA_DIR is optional — only needed during the transition
// period while legacy sub-apps (todo, struggle) still use SQLite.

import { accessSync, constants, statSync } from 'node:fs';

export interface Env {
  readonly PORT: number;
  readonly RAILWAY_ENVIRONMENT: string | null;
  readonly FAIRFOX_SIGNALING_URL: string;
  readonly DATA_DIR: string | null;
}

export function loadEnv(): Env {
  const PORT = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    die(`PORT must be a valid port number, got ${JSON.stringify(process.env.PORT)}`);
  }

  const RAILWAY_ENVIRONMENT: string | null = process.env.RAILWAY_ENVIRONMENT ?? null;
  const FAIRFOX_SIGNALING_URL =
    process.env.FAIRFOX_SIGNALING_URL ?? `ws://localhost:${PORT}/polly/signaling`;

  // DATA_DIR is optional under the mesh architecture. Legacy sub-apps
  // that still use SQLite need it; new sub-apps don't touch it.
  const DATA_DIR: string | null = process.env.DATA_DIR ?? null;
  if (DATA_DIR) {
    let dataStat: ReturnType<typeof statSync>;
    try {
      dataStat = statSync(DATA_DIR);
    } catch (err) {
      die(`DATA_DIR (${DATA_DIR}) does not exist or is not readable: ${errMsg(err)}`);
    }
    if (!dataStat.isDirectory()) {
      die(`DATA_DIR (${DATA_DIR}) exists but is not a directory.`);
    }
    try {
      accessSync(DATA_DIR, constants.W_OK);
    } catch {
      die(`DATA_DIR (${DATA_DIR}) is not writable by this process.`);
    }
    if (RAILWAY_ENVIRONMENT !== null) {
      const rootStat = statSync('/');
      if (dataStat.dev === rootStat.dev) {
        die(
          `RAILWAY_ENVIRONMENT=${RAILWAY_ENVIRONMENT} but DATA_DIR (${DATA_DIR}) is on the same ` +
            'device as /. The Railway volume is not mounted — refusing to start.'
        );
      }
    }
  }

  return { PORT, RAILWAY_ENVIRONMENT, FAIRFOX_SIGNALING_URL, DATA_DIR };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function die(msg: string): never {
  console.error(`[fairfox/env] ${msg}`);
  process.exit(1);
}
