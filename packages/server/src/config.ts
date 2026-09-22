/**
 * The settings the server reads, by name. None has a default (C1): a server
 * that lacks one does not start, and its error names the setting.
 */
export const SETTINGS = {
  /** The commit the server runs. The version route answers it (C5). */
  commit: 'FAIRFOX_COMMIT',
  /** The SQLite database. `:memory:` is an empty database in memory. */
  databasePath: 'FAIRFOX_DATABASE_PATH',
} as const;

/** Settings as a process environment holds them. A test passes them as an argument (C2). */
export type Settings = Readonly<Record<string, string | undefined>>;

export type Config = {
  commit: string;
  databasePath: string;
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
  };
}
