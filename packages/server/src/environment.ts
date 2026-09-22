import type { Settings } from './config.ts';

/**
 * The one place the server reads process.env (C2). The two entry points,
 * main.ts and status.ts, call it; everything else takes settings as an
 * argument, and so do the tests. Bun loads no .env file (bunfig.toml).
 */
export function environment(): Settings {
  return process.env;
}
