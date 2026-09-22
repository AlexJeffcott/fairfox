import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUSY_TIMEOUT_MS, openDatabase } from './database.ts';
import { LATEST_MIGRATION, MIGRATIONS, readMeta } from './migrations/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'fairfox-database-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The one value a PRAGMA answers. busy_timeout answers it in a column named timeout, so the column is not named here. */
function pragma(database: Database, name: string): unknown {
  const found = database.query(`PRAGMA ${name}`).get();
  return typeof found === 'object' && found !== null ? Object.values(found)[0] : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('opening the database', () => {
  test('a new file is set up: WAL, a busy timeout, every migration, a marker', () => {
    const { database, migrated } = openDatabase(join(dir, 'new.db'));
    expect(pragma(database, 'journal_mode')).toBe('wal');
    expect(pragma(database, 'busy_timeout')).toBe(BUSY_TIMEOUT_MS);
    expect(migrated).toStrictEqual({ ran: MIGRATIONS.map((m) => m.name) });
    const meta = readMeta(database);
    expect(meta?.migration).toBe(LATEST_MIGRATION);
    expect(meta?.marker).toMatch(UUID);
    database.close();
  });

  test('a second open runs no migration and keeps the marker', () => {
    const path = join(dir, 'twice.db');
    const first = openDatabase(path);
    const marker = readMeta(first.database)?.marker;
    first.database.close();
    const second = openDatabase(path);
    expect(second.migrated).toStrictEqual({ ran: [] });
    expect(readMeta(second.database)?.marker).toBe(marker);
    second.database.close();
  });

  test('two databases get two markers', () => {
    const a = openDatabase(join(dir, 'a.db'));
    const b = openDatabase(join(dir, 'b.db'));
    expect(readMeta(a.database)?.marker).not.toBe(readMeta(b.database)?.marker);
    a.database.close();
    b.database.close();
  });

  test('a database at a migration this image does not know is left as it is', () => {
    const path = join(dir, 'ahead.db');
    const first = openDatabase(path);
    first.database.query('UPDATE meta SET value = ? WHERE key = ?').run('099-from-a-newer-image', 'migration');
    first.database.close();
    const second = openDatabase(path);
    expect(second.migrated).toStrictEqual({ ahead: '099-from-a-newer-image' });
    expect(readMeta(second.database)?.migration).toBe('099-from-a-newer-image');
    second.database.close();
  });

  test('the migration names are in order and unique', () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(names).toStrictEqual([...new Set(names)].sort());
    expect(names.every((name) => /^\d{3}-[a-z-]+$/.test(name))).toBe(true);
  });
});

describe('reading meta', () => {
  test('a database that was never set up has no meta', () => {
    const database = new Database(':memory:');
    expect(readMeta(database)).toBeUndefined();
    database.close();
  });

  test('a meta table without its rows is not set up', () => {
    const { database } = openDatabase(join(dir, 'broken.db'));
    database.query('DELETE FROM meta WHERE key = ?').run('marker');
    expect(() => readMeta(database)).toThrow('no marker row');
    database.close();
  });
});
