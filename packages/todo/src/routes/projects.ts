import db from '../db';

const list = db.query('SELECT * FROM projects ORDER BY sort_order, pid');
const getOne = db.query('SELECT * FROM projects WHERE pid = ?');
const insert = db.query(`
  INSERT INTO projects (pid, name, parent, category, type, status, dirs, skills, notes, sort_order)
  VALUES ($pid, $name, $parent, $category, $type, $status, $dirs, $skills, $notes, $sort_order)
`);
const update = db.prepare(`
  UPDATE projects SET
    name = $name, parent = $parent, category = $category, type = $type,
    status = $status, dirs = $dirs, skills = $skills, notes = $notes,
    sort_order = $sort_order, updated_at = datetime('now')
  WHERE pid = $pid
`);
const remove = db.query('DELETE FROM projects WHERE pid = ?');

function filtered(params: URLSearchParams) {
  const clauses: string[] = [];
  const values: any[] = [];
  for (const [key, val] of params) {
    if (['category', 'type', 'status', 'parent'].includes(key)) {
      clauses.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (clauses.length === 0) return list.all();
  return db
    .query(`SELECT * FROM projects WHERE ${clauses.join(' AND ')} ORDER BY sort_order, pid`)
    .all(...values);
}

export const projectRoutes = {
  '/api/projects': {
    GET: (req: Request) => {
      const params = new URL(req.url).searchParams;
      return Response.json(filtered(params));
    },
    POST: async (req: Request) => {
      const body = await req.json();
      try {
        insert.run({
          $pid: body.pid,
          $name: body.name,
          $parent: body.parent || null,
          $category: body.category || 'personal',
          $type: body.type || 'coding',
          $status: body.status || 'idea',
          $dirs: body.dirs || '',
          $skills: body.skills || '',
          $notes: body.notes || '',
          $sort_order: body.sort_order ?? 0,
        });
        return Response.json(getOne.get(body.pid), { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/projects/:pid': {
    GET: (req: Request & { params: { pid: string } }) => {
      const row = getOne.get(req.params.pid);
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(row);
    },
    PUT: async (req: Request & { params: { pid: string } }) => {
      const existing = getOne.get(req.params.pid) as any;
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      const body = await req.json();
      try {
        update.run({
          $pid: req.params.pid,
          $name: body.name ?? existing.name,
          $parent: body.parent !== undefined ? body.parent : existing.parent,
          $category: body.category ?? existing.category,
          $type: body.type ?? existing.type,
          $status: body.status ?? existing.status,
          $dirs: body.dirs ?? existing.dirs,
          $skills: body.skills ?? existing.skills,
          $notes: body.notes ?? existing.notes,
          $sort_order: body.sort_order ?? existing.sort_order,
        });
        return Response.json(getOne.get(req.params.pid));
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
    DELETE: (req: Request & { params: { pid: string } }) => {
      const existing = getOne.get(req.params.pid);
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      remove.run(req.params.pid);
      return new Response(null, { status: 204 });
    },
  },
};
