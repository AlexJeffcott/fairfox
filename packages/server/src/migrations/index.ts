import type { Database } from 'bun:sqlite';
import { meta } from './001-meta.ts';
import type { Migration, Setup } from './migration.ts';
import { plan } from './plan.ts';

export type { Migration, Setup } from './migration.ts';

/** Every migration, in the order they run. To add one, add it at the end. */
export const MIGRATIONS: readonly Migration[] = [meta];

/** The name of the latest migration this image knows. */
export const LATEST_MIGRATION = MIGRATIONS.map((m) => m.name).at(-1);

/** The rows of `meta` a restore is read against (S7, C5). */
export type Meta = {
  marker: string;
  migration: string;
};

/** The value of one row of `meta`, or undefined when there is no row with that key. */
function row(database: Database, key: string): string | undefined {
  const found = database.query<{ value: unknown }, [string]>('SELECT value FROM meta WHERE key = ?').get(key);
  if (found === null) {
    return undefined;
  }
  if (typeof found.value !== 'string') {
    throw new Error(`The meta row ${key} holds a value that is not text.`);
  }
  return found.value;
}

function hasMeta(database: Database): boolean {
  return database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== null;
}

/**
 * The marker and the latest migration of a database, or undefined when it
 * has no `meta` table: a database that was never set up.
 */
export function readMeta(database: Database): Meta | undefined {
  if (!hasMeta(database)) {
    return undefined;
  }
  const marker = row(database, 'marker');
  const migration = row(database, 'migration');
  if (marker === undefined || migration === undefined) {
    throw new Error('The meta table holds no marker row, or no migration row: the database is not set up.');
  }
  return { marker, migration };
}

/** What `migrate` did: the migrations it ran, or the name the database is ahead at. */
export type Migrated = { ran: readonly string[] } | { ahead: string };

/**
 * Bring the database to the latest migration. Each migration runs in one
 * transaction with the write of its name, so a migration that fails leaves
 * the database as it was. A new database gets the marker at set-up.
 */
export function migrate(database: Database, setup: Setup): Migrated {
  const applied = hasMeta(database) ? row(database, 'migration') : undefined;
  const planned = plan(
    applied,
    MIGRATIONS.map((m) => m.name),
  );
  if ('ahead' in planned) {
    return planned;
  }
  const pending = MIGRATIONS.filter((m) => planned.run.includes(m.name));
  for (const migration of pending) {
    database.transaction(() => {
      migration.up(database, setup);
      // Prepared after up: the first migration is the one that creates meta.
      database.query('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('migration', migration.name);
    })();
  }
  return { ran: pending.map((m) => m.name) };
}
