import {
  type AgendaItem,
  type Completion,
  type CompletionKind,
  type ItemKind,
  isCompletionKind,
  isItemKind,
  isPerson,
  isRecord,
  isRecurrence,
  isRoom,
  type Person,
  parseRecurrenceData,
  type Recurrence,
  type RecurrenceData,
  type Room,
  shouldAppearToday,
} from '../agenda-logic';
import db from '../db';

interface ItemRow {
  id: number;
  kind: string;
  name: string;
  room: string | null;
  points: number;
  time_of_day: string | null;
  recurrence: string;
  recurrence_data: string;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CompletionRow {
  id: number;
  item_id: number;
  done_by: string;
  done_at: string;
  kind: string;
}

const listActive = db.query<ItemRow, []>(`
  SELECT * FROM agenda_items
  WHERE archived_at IS NULL
  ORDER BY id
`);

const listAll = db.query<ItemRow, []>('SELECT * FROM agenda_items ORDER BY id');

const getItemRow = db.query<ItemRow, [number]>('SELECT * FROM agenda_items WHERE id = ?');

const insertItem = db.query<
  ItemRow,
  [string, string, string | null, number, string | null, string, string, string]
>(`
  INSERT INTO agenda_items (kind, name, room, points, time_of_day, recurrence, recurrence_data, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING *
`);

const updateItem = db.query<
  ItemRow,
  [
    string,
    string,
    string | null,
    number,
    string | null,
    string,
    string,
    string,
    string | null,
    number,
  ]
>(`
  UPDATE agenda_items SET
    kind = ?, name = ?, room = ?, points = ?, time_of_day = ?,
    recurrence = ?, recurrence_data = ?, notes = ?, archived_at = ?,
    updated_at = datetime('now')
  WHERE id = ?
  RETURNING *
`);

const deleteItem = db.query('DELETE FROM agenda_items WHERE id = ?');

const archiveItem = db.query(
  "UPDATE agenda_items SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
);

const insertCompletion = db.query<CompletionRow, [number, string, string]>(`
  INSERT INTO agenda_completions (item_id, done_by, kind)
  VALUES (?, ?, ?)
  RETURNING *
`);

const latestCompletion = db.query<CompletionRow, [number]>(`
  SELECT * FROM agenda_completions
  WHERE item_id = ?
  ORDER BY done_at DESC, id DESC
  LIMIT 1
`);

const fairnessByPerson = db.query<
  { done_by: string; completions: number; total_points: number },
  [string]
>(`
  SELECT c.done_by, COUNT(*) as completions, COALESCE(SUM(i.points), 0) as total_points
  FROM agenda_completions c
  JOIN agenda_items i ON i.id = c.item_id
  WHERE c.kind = 'done' AND c.done_at >= datetime('now', ?)
  GROUP BY c.done_by
  ORDER BY total_points DESC
`);

function rowToItem(row: ItemRow): AgendaItem {
  const kind: ItemKind = isItemKind(row.kind) ? row.kind : 'task';
  const recurrence: Recurrence = isRecurrence(row.recurrence) ? row.recurrence : 'interval';
  const room: Room | null = row.room !== null && isRoom(row.room) ? row.room : null;
  return {
    id: row.id,
    kind,
    name: row.name,
    room,
    points: row.points,
    time_of_day: row.time_of_day,
    recurrence,
    recurrence_data: row.recurrence_data,
    notes: row.notes,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToCompletion(row: CompletionRow): Completion {
  const kind: CompletionKind = isCompletionKind(row.kind) ? row.kind : 'done';
  const doneBy: Person = isPerson(row.done_by) ? row.done_by : 'Alex';
  return {
    id: row.id,
    item_id: row.item_id,
    done_by: doneBy,
    done_at: row.done_at,
    kind,
  };
}

interface ItemInput {
  kind: ItemKind;
  name: string;
  room: Room | null;
  points: number;
  time_of_day: string | null;
  recurrence: Recurrence;
  recurrence_data: string;
  notes: string;
}

function readItemInput(body: unknown): ItemInput {
  if (!isRecord(body)) {
    throw new Error('request body must be a JSON object');
  }
  if (!isItemKind(body.kind)) {
    throw new Error("kind must be 'task' or 'event'");
  }
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    throw new Error('name is required');
  }
  let room: Room | null = null;
  if (body.room !== undefined && body.room !== null) {
    if (!isRoom(body.room)) {
      throw new Error(`invalid room: ${JSON.stringify(body.room)}`);
    }
    room = body.room;
  }
  let points = 1;
  if (body.points !== undefined) {
    if (
      typeof body.points !== 'number' ||
      !Number.isInteger(body.points) ||
      body.points < 1 ||
      body.points > 10
    ) {
      throw new Error('points must be an integer 1-10');
    }
    points = body.points;
  }
  let timeOfDay: string | null = null;
  if (body.time_of_day !== undefined && body.time_of_day !== null) {
    if (
      typeof body.time_of_day !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time_of_day)
    ) {
      throw new Error('time_of_day must be HH:MM (24h)');
    }
    timeOfDay = body.time_of_day;
  }
  if (!isRecurrence(body.recurrence)) {
    throw new Error("recurrence must be one of 'once' | 'daily' | 'weekdays' | 'interval'");
  }
  let recurrenceDataRaw: string;
  if (typeof body.recurrence_data === 'string') {
    recurrenceDataRaw = body.recurrence_data;
  } else if (body.recurrence_data === undefined) {
    recurrenceDataRaw = body.recurrence === 'daily' ? '{}' : '';
  } else {
    recurrenceDataRaw = JSON.stringify(body.recurrence_data);
  }
  parseRecurrenceData(body.recurrence, recurrenceDataRaw);
  const notes = typeof body.notes === 'string' ? body.notes : '';
  return {
    kind: body.kind,
    name: body.name.trim(),
    room,
    points,
    time_of_day: timeOfDay,
    recurrence: body.recurrence,
    recurrence_data: recurrenceDataRaw,
    notes,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface TodayItem {
  item: AgendaItem;
  daysOverdue: number;
  lastCompletion: Completion | null;
}

interface TodayResponse {
  date: string;
  scheduled: TodayItem[];
  anytime: TodayItem[];
}

function buildToday(now: Date): TodayResponse {
  const rows = listActive.all();
  const scheduled: TodayItem[] = [];
  const anytime: TodayItem[] = [];
  for (const row of rows) {
    const item = rowToItem(row);
    let parsed: RecurrenceData;
    try {
      parsed = parseRecurrenceData(item.recurrence, item.recurrence_data);
    } catch {
      continue;
    }
    const lastRow = latestCompletion.get(item.id);
    const last = lastRow !== null ? rowToCompletion(lastRow) : null;
    const visibility = shouldAppearToday(item, parsed, last, now);
    if (!visibility.visible) {
      continue;
    }
    const entry: TodayItem = {
      item,
      daysOverdue: visibility.daysOverdue,
      lastCompletion: last,
    };
    if (item.time_of_day !== null) {
      scheduled.push(entry);
    } else {
      anytime.push(entry);
    }
  }
  scheduled.sort((a, b) => {
    const ta = a.item.time_of_day ?? '';
    const tb = b.item.time_of_day ?? '';
    return ta.localeCompare(tb);
  });
  anytime.sort((a, b) => b.daysOverdue - a.daysOverdue);
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { date: dateStr, scheduled, anytime };
}

export const agendaRoutes = {
  '/api/agenda/items': {
    GET: () => {
      const rows = listAll.all();
      return Response.json(rows.map(rowToItem));
    },
    POST: async (req: Request) => {
      let body: unknown;
      try {
        body = await req.json();
      } catch (err) {
        return Response.json({ error: `invalid JSON: ${errMsg(err)}` }, { status: 400 });
      }
      let input: ItemInput;
      try {
        input = readItemInput(body);
      } catch (err) {
        return Response.json({ error: errMsg(err) }, { status: 400 });
      }
      try {
        const row = insertItem.get(
          input.kind,
          input.name,
          input.room,
          input.points,
          input.time_of_day,
          input.recurrence,
          input.recurrence_data,
          input.notes
        );
        if (row === null) {
          return Response.json({ error: 'insert returned no row' }, { status: 500 });
        }
        return Response.json(rowToItem(row), { status: 201 });
      } catch (err) {
        return Response.json({ error: errMsg(err) }, { status: 400 });
      }
    },
  },
  '/api/agenda/items/:id': {
    GET: (req: Request & { params: { id: string } }) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return Response.json({ error: 'invalid id' }, { status: 400 });
      }
      const row = getItemRow.get(id);
      if (row === null) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      return Response.json(rowToItem(row));
    },
    PUT: async (req: Request & { params: { id: string } }) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return Response.json({ error: 'invalid id' }, { status: 400 });
      }
      const existing = getItemRow.get(id);
      if (existing === null) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch (err) {
        return Response.json({ error: `invalid JSON: ${errMsg(err)}` }, { status: 400 });
      }
      const merged = mergeForUpdate(existing, body);
      let input: ItemInput;
      try {
        input = readItemInput(merged.input);
      } catch (err) {
        return Response.json({ error: errMsg(err) }, { status: 400 });
      }
      try {
        const updated = updateItem.get(
          input.kind,
          input.name,
          input.room,
          input.points,
          input.time_of_day,
          input.recurrence,
          input.recurrence_data,
          input.notes,
          merged.archivedAt,
          id
        );
        if (updated === null) {
          return Response.json({ error: 'update returned no row' }, { status: 500 });
        }
        return Response.json(rowToItem(updated));
      } catch (err) {
        return Response.json({ error: errMsg(err) }, { status: 400 });
      }
    },
    DELETE: (req: Request & { params: { id: string } }) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return Response.json({ error: 'invalid id' }, { status: 400 });
      }
      const existing = getItemRow.get(id);
      if (existing === null) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      deleteItem.run(id);
      return new Response(null, { status: 204 });
    },
  },
  '/api/agenda/items/:id/complete': {
    POST: async (req: Request & { params: { id: string } }) => {
      const id = parseId(req.params.id);
      if (id === null) {
        return Response.json({ error: 'invalid id' }, { status: 400 });
      }
      const itemRow = getItemRow.get(id);
      if (itemRow === null) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      const item = rowToItem(itemRow);
      if (item.kind === 'event') {
        return Response.json({ error: 'events cannot be completed' }, { status: 400 });
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch (err) {
        return Response.json({ error: `invalid JSON: ${errMsg(err)}` }, { status: 400 });
      }
      if (!isRecord(body)) {
        return Response.json({ error: 'body must be an object' }, { status: 400 });
      }
      if (!isPerson(body.done_by)) {
        return Response.json({ error: 'done_by must be Leo, Elisa, or Alex' }, { status: 400 });
      }
      const completionKind: CompletionKind = isCompletionKind(body.kind) ? body.kind : 'done';
      try {
        const completionRow = insertCompletion.get(id, body.done_by, completionKind);
        if (completionRow === null) {
          return Response.json({ error: 'insert returned no row' }, { status: 500 });
        }
        if (completionKind === 'done' && item.recurrence === 'once') {
          archiveItem.run(id);
        }
        return Response.json(rowToCompletion(completionRow), { status: 201 });
      } catch (err) {
        return Response.json({ error: errMsg(err) }, { status: 400 });
      }
    },
  },
  '/api/agenda/today': {
    GET: () => {
      return Response.json(buildToday(new Date()));
    },
  },
  '/api/agenda/fairness': {
    GET: (req: Request) => {
      const params = new URL(req.url).searchParams;
      const days = Number(params.get('days') ?? '30');
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return Response.json({ error: 'days must be 1-365' }, { status: 400 });
      }
      const rows = fairnessByPerson.all(`-${days} days`);
      return Response.json({ days, by_person: rows });
    },
  },
};

interface MergedUpdate {
  input: Record<string, unknown>;
  archivedAt: string | null;
}

function mergeForUpdate(existing: ItemRow, body: unknown): MergedUpdate {
  const incoming: Record<string, unknown> = isRecord(body) ? body : {};
  const merged: Record<string, unknown> = {
    kind: incoming.kind ?? existing.kind,
    name: incoming.name ?? existing.name,
    room: incoming.room === undefined ? existing.room : incoming.room,
    points: incoming.points ?? existing.points,
    time_of_day: incoming.time_of_day === undefined ? existing.time_of_day : incoming.time_of_day,
    recurrence: incoming.recurrence ?? existing.recurrence,
    recurrence_data:
      incoming.recurrence_data === undefined ? existing.recurrence_data : incoming.recurrence_data,
    notes: incoming.notes ?? existing.notes,
  };
  let archivedAt: string | null = existing.archived_at;
  if (incoming.archived_at !== undefined) {
    if (incoming.archived_at === null) {
      archivedAt = null;
    } else if (typeof incoming.archived_at === 'string') {
      archivedAt = incoming.archived_at;
    }
  }
  return { input: merged, archivedAt };
}
