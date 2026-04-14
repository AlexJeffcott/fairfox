import { openDb } from '@fairfox/shared/openDb';

const db = openDb('todo');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    pid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent TEXT,
    category TEXT NOT NULL DEFAULT 'personal',
    type TEXT NOT NULL DEFAULT 'coding',
    status TEXT NOT NULL DEFAULT 'idea',
    dirs TEXT NOT NULL DEFAULT '',
    skills TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent) REFERENCES projects(pid)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    tid TEXT PRIMARY KEY,
    done INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    project TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS to_buy (
    bid TEXT PRIMARY KEY,
    item TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'researching',
    price TEXT NOT NULL DEFAULT '',
    vendor TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS city_home (
    hid TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    notes TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS directories (
    dir TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quick_capture (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    body TEXT NOT NULL DEFAULT '',
    project TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    context_type TEXT NOT NULL DEFAULT '',
    context_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender TEXT NOT NULL DEFAULT 'user',
    text TEXT NOT NULL,
    pending INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS agenda_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('task', 'event')),
    name TEXT NOT NULL,
    room TEXT CHECK (room IS NULL OR room IN (
      'kitchen', 'master_bedroom', 'leos_bedroom', 'music_room', 'music_room_balcony',
      'utility_room', 'living_room', 'kitchen_balcony', 'guest_bathroom', 'main_bathroom',
      'entrance_hall'
    )),
    points INTEGER NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 10),
    time_of_day TEXT CHECK (
      time_of_day IS NULL
      OR time_of_day GLOB '[0-1][0-9]:[0-5][0-9]'
      OR time_of_day GLOB '2[0-3]:[0-5][0-9]'
    ),
    recurrence TEXT NOT NULL CHECK (recurrence IN ('once', 'daily', 'weekdays', 'interval')),
    recurrence_data TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agenda_items_active
    ON agenda_items(archived_at);

  CREATE TABLE IF NOT EXISTS agenda_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    done_by TEXT NOT NULL CHECK (done_by IN ('Leo', 'Elisa', 'Alex')),
    done_at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT NOT NULL DEFAULT 'done' CHECK (kind IN ('done', 'snooze_1d', 'snooze_3d', 'snooze_7d')),
    FOREIGN KEY (item_id) REFERENCES agenda_items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_agenda_completions_item
    ON agenda_completions(item_id, done_at DESC);
`);

const nullTasks = db.query('SELECT rowid, * FROM tasks WHERE tid IS NULL').all() as any[];
if (nullTasks.length > 0) {
  const maxTid = db
    .query("SELECT MAX(CAST(SUBSTR(tid, 2) AS INTEGER)) as n FROM tasks WHERE tid GLOB 'T[0-9]*'")
    .get() as any;
  let next = (maxTid?.n || 0) + 1;
  for (const t of nullTasks) {
    const newTid = `T${next++}`;
    db.query('UPDATE tasks SET tid = ? WHERE rowid = ?').run(newTid, t.rowid);
    console.log(`[todo] fixed null TID task → ${newTid}: ${t.description?.slice(0, 60)}`);
  }
}

export default db;
