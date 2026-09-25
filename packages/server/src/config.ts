/**
 * The settings the server reads, by name. None has a default (C1): a server
 * that lacks one does not start, and its error names the setting. Every name
 * here is in DEPLOY.md, with where it is set; the check env-list compares the
 * two lists (C3).
 */
export const SETTINGS = {
  /** The commit the server runs. The version route answers it (C5). `devctl deploy` sets it on each deploy. */
  commit: 'FAIRFOX_COMMIT',
  /** The SQLite database. `:memory:` is an empty database in memory. Litestream reads the same variable (C1). */
  databasePath: 'FAIRFOX_DATABASE_PATH',
  /** The port the server listens on. fly.toml's internal_port is the same number. */
  port: 'FAIRFOX_PORT',
  /** Where Litestream replicates the database to (S7a). A secret on Fly: it names the bucket. */
  replicaUrl: 'FAIRFOX_REPLICA_URL',
  /** The shared secret of the relay fairfox-turn. The check 3 routes mint relay credentials with it. Step 0c only. */
  turnSecret: 'FAIRFOX_TURN_SECRET',
} as const;

/** Settings as a process environment holds them. A test passes them as an argument (C2). */
export type Settings = Readonly<Record<string, string | undefined>>;

/** What the app needs: the commit it answers, the database it opens, and the relay's secret for check 3. */
export type Config = {
  commit: string;
  databasePath: string;
  turnSecret: string;
};

function required(settings: Settings, name: string): string {
  const value = settings[name];
  if (value === undefined || value === '') {
    throw new Error(`The setting ${name} is not set. It has no default.`);
  }
  return value;
}

export function readConfig(settings: Settings): Config {
  return {
    commit: required(settings, SETTINGS.commit),
    databasePath: required(settings, SETTINGS.databasePath),
    turnSecret: required(settings, SETTINGS.turnSecret),
  };
}

/** The port to listen on: a whole number from 1 to 65535, or the server does not start. */
export function readPort(settings: Settings): number {
  const value = required(settings, SETTINGS.port);
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new Error(`The setting ${SETTINGS.port} is ${JSON.stringify(value)}, not a port from 1 to 65535.`);
  }
  return port;
}

/** What the status command needs: the database to read and the replica to age. */
export type StatusConfig = {
  databasePath: string;
  replicaUrl: string;
};

export function readStatusConfig(settings: Settings): StatusConfig {
  return {
    databasePath: required(settings, SETTINGS.databasePath),
    replicaUrl: required(settings, SETTINGS.replicaUrl),
  };
}
