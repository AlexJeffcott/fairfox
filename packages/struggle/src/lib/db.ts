import type { Database } from 'bun:sqlite';
import { bind } from './bind.ts';
import { textToHtml } from './html.ts';

interface Migration {
  version: number;
  name: string;
  sql: string;
  after?: (db: Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'create_chapters',
    sql: `CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      initial_state TEXT NOT NULL DEFAULT '{}',
      start_passage TEXT NOT NULL
    )`,
  },
  {
    version: 2,
    name: 'create_passages',
    sql: `CREATE TABLE passages (
      id TEXT NOT NULL,
      chapter_id TEXT NOT NULL REFERENCES chapters(id),
      type TEXT,
      next TEXT,
      set_vars TEXT,
      condition TEXT,
      death TEXT,
      is_end INTEGER NOT NULL DEFAULT 0,
      is_title_page INTEGER NOT NULL DEFAULT 0,
      is_inspection INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (id, chapter_id)
    )`,
  },
  {
    version: 3,
    name: 'create_paragraphs',
    sql: `CREATE TABLE paragraphs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passage_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'body',
      sort_order INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (passage_id, chapter_id) REFERENCES passages(id, chapter_id)
    )`,
  },
  {
    version: 4,
    name: 'create_choices',
    sql: `CREATE TABLE choices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passage_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'body',
      label TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'navigate',
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (passage_id, chapter_id) REFERENCES passages(id, chapter_id)
    )`,
  },
  {
    version: 5,
    name: 'create_litanies',
    sql: `CREATE TABLE litanies (
      id TEXT PRIMARY KEY,
      passage_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      FOREIGN KEY (passage_id, chapter_id) REFERENCES passages(id, chapter_id)
    )`,
  },
  {
    version: 6,
    name: 'create_place_names',
    sql: `CREATE TABLE place_names (
      passage_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (passage_id, chapter_id),
      FOREIGN KEY (passage_id, chapter_id) REFERENCES passages(id, chapter_id)
    )`,
  },
  {
    version: 7,
    name: 'create_rewrites',
    sql: `CREATE TABLE rewrites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      paragraph_id INTEGER,
      old_text TEXT NOT NULL,
      new_text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 8,
    name: 'create_references',
    sql: `CREATE TABLE refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      form TEXT NOT NULL DEFAULT 'prose',
      tags TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 9,
    name: 'create_feedback',
    sql: `CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id TEXT NOT NULL,
      passage_id TEXT NOT NULL,
      paragraph_id INTEGER,
      paragraph_text TEXT,
      comment TEXT,
      game_state TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 10,
    name: 'migrate_paragraphs_to_passage_content',
    sql: `CREATE TABLE passage_content (
      passage_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'body',
      html TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (passage_id, chapter_id, context),
      FOREIGN KEY (passage_id, chapter_id) REFERENCES passages(id, chapter_id)
    )`,
    after(db: Database) {
      // Migrate existing paragraphs → passage_content
      const rows = db
        .query(
          `SELECT passage_id, chapter_id, context, group_concat(text, char(10,10)) as assembled
           FROM (SELECT * FROM paragraphs ORDER BY sort_order)
           GROUP BY passage_id, chapter_id, context`
        )
        .all() as { passage_id: string; chapter_id: string; context: string; assembled: string }[];

      const insert = db.query(
        `INSERT INTO passage_content (passage_id, chapter_id, context, html)
         VALUES ($pid, $ch, $ctx, $html)`
      );
      for (const row of rows) {
        insert.run({
          $pid: row.passage_id,
          $ch: row.chapter_id,
          $ctx: row.context,
          $html: textToHtml(row.assembled),
        });
      }

      db.run('DROP TABLE paragraphs');
    },
  },
];

export function runMigrations(db: Database): void {
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA synchronous = NORMAL');
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const rows = db.query('SELECT version FROM _migrations').all() as Array<{ version: number }>;
  const applied = new Set(rows.map((r) => r.version));

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) {
      continue;
    }
    const run = db.transaction(() => {
      db.run(m.sql);
      if (m.after) {
        m.after(db);
      }
      db.run(
        'INSERT INTO _migrations (version, name) VALUES ($v, $n)',
        bind({
          $v: m.version,
          $n: m.name,
        })
      );
    });
    run();
    console.log(`[struggle] migration ${m.version}: ${m.name}`);
  }
}
