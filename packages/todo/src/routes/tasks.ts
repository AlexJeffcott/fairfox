import db from '../db';

const list = db.query('SELECT * FROM tasks ORDER BY sort_order, tid');
const getOne = db.query('SELECT * FROM tasks WHERE tid = ?');
const insert = db.query(`
  INSERT INTO tasks (tid, done, description, project, priority, links, notes, sort_order)
  VALUES ($tid, $done, $description, $project, $priority, $links, $notes, $sort_order)
`);
const update = db.prepare(`
  UPDATE tasks SET
    done = $done, description = $description, project = $project,
    priority = $priority, links = $links, notes = $notes,
    sort_order = $sort_order, updated_at = datetime('now')
  WHERE tid = $tid
`);
const remove = db.query('DELETE FROM tasks WHERE tid = ?');

function filtered(params: URLSearchParams) {
  const clauses: string[] = [];
  const values: any[] = [];
  for (const [key, val] of params) {
    if (key === 'done') {
      clauses.push('done = ?');
      values.push(val === 'true' ? 1 : 0);
    } else if (['project', 'priority'].includes(key)) {
      clauses.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (clauses.length === 0) return list.all();
  return db
    .query(`SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY sort_order, tid`)
    .all(...values);
}

export const taskRoutes = {
  '/api/tasks': {
    GET: (req: Request) => {
      const params = new URL(req.url).searchParams;
      return Response.json(filtered(params));
    },
    POST: async (req: Request) => {
      const body = await req.json();
      if (!body.tid || typeof body.tid !== 'string' || !body.tid.trim()) {
        return Response.json({ error: 'tid is required' }, { status: 400 });
      }
      if (!body.description) {
        return Response.json({ error: 'description is required' }, { status: 400 });
      }
      try {
        insert.run({
          $tid: body.tid,
          $done: body.done ? 1 : 0,
          $description: body.description,
          $project: body.project,
          $priority: body.priority || '',
          $links: body.links || '',
          $notes: body.notes || '',
          $sort_order: body.sort_order ?? 0,
        });
        return Response.json(getOne.get(body.tid), { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/tasks/:tid': {
    GET: (req: Request & { params: { tid: string } }) => {
      const row = getOne.get(req.params.tid);
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(row);
    },
    PUT: async (req: Request & { params: { tid: string } }) => {
      const existing = getOne.get(req.params.tid) as any;
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      const body = await req.json();
      try {
        update.run({
          $tid: req.params.tid,
          $done: body.done !== undefined ? (body.done ? 1 : 0) : existing.done,
          $description: body.description ?? existing.description,
          $project: body.project ?? existing.project,
          $priority: body.priority ?? existing.priority,
          $links: body.links ?? existing.links,
          $notes: body.notes ?? existing.notes,
          $sort_order: body.sort_order ?? existing.sort_order,
        });
        return Response.json(getOne.get(req.params.tid));
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
    DELETE: (req: Request & { params: { tid: string } }) => {
      const existing = getOne.get(req.params.tid);
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      remove.run(req.params.tid);
      return new Response(null, { status: 204 });
    },
  },
};
