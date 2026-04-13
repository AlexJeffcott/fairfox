import { Database } from 'bun:sqlite';
import { loadEnv } from './env.ts';

export type DbName = 'todo' | 'struggle';

export function openDb(name: DbName): Database {
  const { DATA_DIR } = loadEnv();
  const db = new Database(`${DATA_DIR}/${name}.db`, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
