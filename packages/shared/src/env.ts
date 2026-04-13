import { accessSync, constants, statSync } from 'node:fs';

export interface Env {
  readonly DATA_DIR: string;
  readonly PORT: number;
  readonly RAILWAY_ENVIRONMENT: string | null;
}

export function loadEnv(): Env {
  const DATA_DIR = process.env.DATA_DIR;
  if (!DATA_DIR || DATA_DIR.length === 0) {
    die(
      'DATA_DIR is not set. Set it to the volume mount path (e.g. /data in Railway, ./data in dev).'
    );
  }

  const PORT = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    die(`PORT must be a valid port number, got ${JSON.stringify(process.env.PORT)}`);
  }

  const RAILWAY_ENVIRONMENT: string | null = process.env.RAILWAY_ENVIRONMENT ?? null;

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
          'device as /. The Railway volume is not mounted \u2014 refusing to start.'
      );
    }
  }

  return { DATA_DIR, PORT, RAILWAY_ENVIRONMENT };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function die(msg: string): never {
  console.error(`[fairfox/env] ${msg}`);
  process.exit(1);
}
