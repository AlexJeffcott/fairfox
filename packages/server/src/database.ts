import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { type Migrated, migrate } from './migrations/index.ts';

/** How long a write waits on a lock before it fails: Litestream holds a read lock while it copies the WAL. */
export const BUSY_TIMEOUT_MS = 5000;

export type Opened = {
  database: Database;
  migrated: Migrated;
};

/**
 * Open the database at `path`, in WAL mode, which Litestream needs to
 * replicate it (S7a), and bring it to the latest migration. A path that
 * does not exist is created: the marker is written then, once (S7).
 */
export function openDatabase(path: string): Opened {
  const database = new Database(path);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const migrated = migrate(database, { marker: randomUUID() });
  return { database, migrated };
}
