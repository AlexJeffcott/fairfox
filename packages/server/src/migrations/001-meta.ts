import type { Migration } from './migration.ts';

/**
 * The first migration: the `meta` table, one row per key. Two rows are
 * written here: `marker`, a value made once at set-up and never changed,
 * which a restore of the replica is read against (S7); and `migration`, the
 * name of the latest migration applied, which the runner keeps current.
 */
export const meta: Migration = {
  name: '001-meta',
  up: (database, setup) => {
    database.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    database.query('INSERT INTO meta (key, value) VALUES (?, ?)').run('marker', setup.marker);
  },
};
