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
  /** Public TURN URL the relay hands to clients (e.g.
   * `turn:fairfox-turn-….up.railway.app:3478`). When unset, the
   * `/turn-credentials` route still answers but only with STUN —
   * peers behind symmetric NATs (CGNAT, corporate firewalls) will
   * fail to connect. */
  readonly FAIRFOX_TURN_URL: string | null;
  /** Shared secret coturn validates HMAC-SHA1 credentials against
   * (`use-auth-secret` mode). Held by the relay so it can mint
   * short-lived `username:credential` pairs without coordinating
   * with the TURN server beyond this single value. Server-side
   * only — never shipped to clients. */
  readonly FAIRFOX_TURN_SHARED_SECRET: string | null;
  /** TTL for minted TURN credentials, in seconds. Defaults to
   * 600s (10 min). The TTL bounds the window during which a
   * leaked credential pair can be reused. Long enough that a
   * single browser session doesn't keep refetching; short enough
   * that compromise blast radius is minutes, not days. */
  readonly FAIRFOX_TURN_TTL_SECONDS: number;
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
  // that still use SQLite need it; new sub-apps don't touch it. An
  // empty string is treated the same as unset so a fly.toml that
  // sets `DATA_DIR = ""` to override the Dockerfile default doesn't
  // trip the directory-validation branch below.
  const DATA_DIR: string | null = process.env.DATA_DIR?.trim() || null;
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

  const FAIRFOX_TURN_URL: string | null = process.env.FAIRFOX_TURN_URL?.trim() || null;
  const FAIRFOX_TURN_SHARED_SECRET: string | null =
    process.env.FAIRFOX_TURN_SHARED_SECRET?.trim() || null;

  // Asymmetric configuration is almost always a deploy mistake — a
  // URL with no secret means clients ask for creds and get nothing;
  // a secret with no URL means we'd mint creds nobody can target.
  // Refuse to start so the operator notices at deploy time, not
  // when peers silently fail to pair.
  if (FAIRFOX_TURN_URL && !/^turns?:/.test(FAIRFOX_TURN_URL)) {
    // The browser's RTCPeerConnection rejects iceServers entries
    // without a `turn:` or `turns:` scheme — and rejects them
    // silently from the application's point of view: the resolver
    // succeeds, polly accepts the array, and the failure only
    // shows up as ICE never finding a working candidate pair.
    // Catch the missing scheme here so the operator sees a hard
    // boot error instead of chasing peers=0 again.
    die(
      `FAIRFOX_TURN_URL must start with "turn:" or "turns:" (got ${JSON.stringify(FAIRFOX_TURN_URL)}).`
    );
  }
  if (FAIRFOX_TURN_URL && !FAIRFOX_TURN_SHARED_SECRET) {
    die('FAIRFOX_TURN_URL is set but FAIRFOX_TURN_SHARED_SECRET is not — both are required.');
  }
  if (FAIRFOX_TURN_SHARED_SECRET && !FAIRFOX_TURN_URL) {
    die('FAIRFOX_TURN_SHARED_SECRET is set but FAIRFOX_TURN_URL is not — both are required.');
  }

  const ttlRaw = process.env.FAIRFOX_TURN_TTL_SECONDS;
  const FAIRFOX_TURN_TTL_SECONDS =
    ttlRaw === undefined || ttlRaw.trim() === '' ? 600 : Number(ttlRaw);
  if (
    !Number.isInteger(FAIRFOX_TURN_TTL_SECONDS) ||
    FAIRFOX_TURN_TTL_SECONDS < 60 ||
    FAIRFOX_TURN_TTL_SECONDS > 86400
  ) {
    die(
      `FAIRFOX_TURN_TTL_SECONDS must be an integer in [60, 86400], got ${JSON.stringify(ttlRaw)}`
    );
  }

  return {
    PORT,
    RAILWAY_ENVIRONMENT,
    FAIRFOX_SIGNALING_URL,
    DATA_DIR,
    FAIRFOX_TURN_URL,
    FAIRFOX_TURN_SHARED_SECRET,
    FAIRFOX_TURN_TTL_SECONDS,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function die(msg: string): never {
  console.error(`[fairfox/env] ${msg}`);
  process.exit(1);
}
