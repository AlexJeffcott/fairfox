import type { Database } from 'bun:sqlite';
import { meta } from './001-meta.ts';
import type { Migration, Setup } from './migration.ts';
import { plan } from './plan.ts';

export type { Migration, Setup } from './migration.ts';

/** Every migration, in the order they run. To add one, add it at the end. */
export const MIGRATIONS: readonly Migration[] = [meta];

/** The name of the latest migration this image knows. */
export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1]?.name;

/** The rows of `meta` a restore is read against (S7, C5). */
export type Meta = {
  marker: string;
  migration: string;
};

function row(database: Database, key: string): string | undefined {
  const found: unknown = database.query('SELECT value FROM meta WHERE key = ?').get(key);
  if (typeof found !== 'object' || found === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(found, 'value');
  return typeof value === 'string' ? value : undefined;
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
  for (const name of planned.run) {
    const migration = MIGRATIONS.find((m) => m.name === name);
    if (migration === undefined) {
      throw new Error(`No migration is named ${name}`);
    }
    database.transaction(() => {
      migration.up(database, setup);
      // Prepared after up: the first migration is the one that creates meta.
      database.query('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('migration', migration.name);
    })();
  }
  return { ran: planned.run };
}
