import type { Database } from 'bun:sqlite';

/** What the set-up of a new database is given. */
export type Setup = {
  /** The marker row's value: made once, at set-up. */
  marker: string;
};

/**
 * One forward migration (C6). Its name is `NNN-what`, and the runner keeps
 * the latest name in the `migration` row of `meta`. Each runs inside one
 * transaction, and each leaves the database readable by the image before it.
 */
export type Migration = {
  name: string;
  up: (database: Database, setup: Setup) => void;
};
