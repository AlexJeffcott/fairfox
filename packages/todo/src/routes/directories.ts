import db from '../db';

const list = db.query('SELECT * FROM directories ORDER BY sort_order, dir');
const getOne = db.query('SELECT * FROM directories WHERE dir = ?');
const insert = db.query(`
  INSERT INTO directories (dir, description, sort_order)
  VALUES ($dir, $description, $sort_order)
`);
const update = db.prepare(`
  UPDATE directories SET
    description = $description, sort_order = $sort_order, updated_at = datetime('now')
  WHERE dir = $dir
`);
const remove = db.query('DELETE FROM directories WHERE dir = ?');

export const directoryRoutes = {
  '/api/directories': {
    GET: () => Response.json(list.all()),
    POST: async (req: Request) => {
      const body = await req.json();
      try {
        insert.run({
          $dir: body.dir,
          $description: body.description || '',
          $sort_order: body.sort_order ?? 0,
        });
        return Response.json(getOne.get(body.dir), { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/directories/:dir': {
    GET: (req: Request & { params: { dir: string } }) => {
      const row = getOne.get(req.params.dir);
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(row);
    },
    PUT: async (req: Request & { params: { dir: string } }) => {
      const existing = getOne.get(req.params.dir) as any;
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      const body = await req.json();
      try {
        update.run({
          $dir: req.params.dir,
          $description: body.description ?? existing.description,
          $sort_order: body.sort_order ?? existing.sort_order,
        });
        return Response.json(getOne.get(req.params.dir));
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
    DELETE: (req: Request & { params: { dir: string } }) => {
      const existing = getOne.get(req.params.dir);
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      remove.run(req.params.dir);
      return new Response(null, { status: 204 });
    },
  },
};
