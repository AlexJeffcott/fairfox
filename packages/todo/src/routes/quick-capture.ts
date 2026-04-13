import db from '../db';

const list = db.query('SELECT * FROM quick_capture ORDER BY id');
const getOne = db.query('SELECT * FROM quick_capture WHERE id = ?');
const insert = db.query('INSERT INTO quick_capture (text) VALUES (?)');
const remove = db.query('DELETE FROM quick_capture WHERE id = ?');

export const quickCaptureRoutes = {
  '/api/quick-capture': {
    GET: () => Response.json(list.all()),
    POST: async (req: Request) => {
      const body = await req.json();
      try {
        const result = insert.run(body.text);
        return Response.json(getOne.get(result.lastInsertRowid), { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/quick-capture/:id': {
    GET: (req: Request & { params: { id: string } }) => {
      const row = getOne.get(Number(req.params.id));
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(row);
    },
    DELETE: (req: Request & { params: { id: string } }) => {
      const existing = getOne.get(Number(req.params.id));
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      remove.run(Number(req.params.id));
      return new Response(null, { status: 204 });
    },
  },
};
