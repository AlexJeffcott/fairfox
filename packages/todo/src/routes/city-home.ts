import db from '../db';

const list = db.query('SELECT * FROM city_home ORDER BY sort_order, hid');
const getOne = db.query('SELECT * FROM city_home WHERE hid = ?');
const insert = db.query(`
  INSERT INTO city_home (hid, task, status, notes, detail, sort_order)
  VALUES ($hid, $task, $status, $notes, $detail, $sort_order)
`);
const update = db.prepare(`
  UPDATE city_home SET
    task = $task, status = $status, notes = $notes, detail = $detail,
    sort_order = $sort_order, updated_at = datetime('now')
  WHERE hid = $hid
`);
const remove = db.query('DELETE FROM city_home WHERE hid = ?');

function filtered(params: URLSearchParams) {
  const clauses: string[] = [];
  const values: any[] = [];
  for (const [key, val] of params) {
    if (key === 'status') {
      clauses.push('status = ?');
      values.push(val);
    }
  }
  if (clauses.length === 0) return list.all();
  return db
    .query(`SELECT * FROM city_home WHERE ${clauses.join(' AND ')} ORDER BY sort_order, hid`)
    .all(...values);
}

export const cityHomeRoutes = {
  '/api/city-home': {
    GET: (req: Request) => {
      const params = new URL(req.url).searchParams;
      return Response.json(filtered(params));
    },
    POST: async (req: Request) => {
      const body = await req.json();
      try {
        insert.run({
          $hid: body.hid,
          $task: body.task,
          $status: body.status || 'todo',
          $notes: body.notes || '',
          $detail: body.detail || '',
          $sort_order: body.sort_order ?? 0,
        });
        return Response.json(getOne.get(body.hid), { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/city-home/:hid': {
    GET: (req: Request & { params: { hid: string } }) => {
      const row = getOne.get(req.params.hid);
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(row);
    },
    PUT: async (req: Request & { params: { hid: string } }) => {
      const existing = getOne.get(req.params.hid) as any;
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      const body = await req.json();
      try {
        update.run({
          $hid: req.params.hid,
          $task: body.task ?? existing.task,
          $status: body.status ?? existing.status,
          $notes: body.notes ?? existing.notes,
          $detail: body.detail ?? existing.detail,
          $sort_order: body.sort_order ?? existing.sort_order,
        });
        return Response.json(getOne.get(req.params.hid));
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
    DELETE: (req: Request & { params: { hid: string } }) => {
      const existing = getOne.get(req.params.hid);
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      remove.run(req.params.hid);
      return new Response(null, { status: 204 });
    },
  },
};
