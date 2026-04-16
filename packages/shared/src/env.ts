// Environment configuration for the fairfox server. Under the meshState
// architecture the server is a stateless signaling relay + cron host +
// LLM proxy, so it needs a signaling URL and a port but no data directory.

export interface Env {
  readonly PORT: number;
  readonly RAILWAY_ENVIRONMENT: string | null;
  readonly FAIRFOX_SIGNALING_URL: string;
}

export function loadEnv(): Env {
  const PORT = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    die(`PORT must be a valid port number, got ${JSON.stringify(process.env.PORT)}`);
  }

  const RAILWAY_ENVIRONMENT: string | null = process.env.RAILWAY_ENVIRONMENT ?? null;

  const FAIRFOX_SIGNALING_URL =
    process.env.FAIRFOX_SIGNALING_URL ?? `ws://localhost:${PORT}/polly/signaling`;

  return { PORT, RAILWAY_ENVIRONMENT, FAIRFOX_SIGNALING_URL };
}

function die(msg: string): never {
  console.error(`[fairfox/env] ${msg}`);
  process.exit(1);
}
