import db from '../db';

const list = db.query(
  'SELECT id, title, slug, project, created_at, updated_at FROM documents ORDER BY updated_at DESC'
);
const getById = db.query('SELECT * FROM documents WHERE id = ?');
const insert = db.query(`
  INSERT INTO documents (title, slug, body, project)
  VALUES ($title, $slug, $body, $project)
`);
const update = db.prepare(`
  UPDATE documents SET
    title = $title, slug = $slug, body = $body, project = $project,
    updated_at = datetime('now')
  WHERE id = $id
`);
const remove = db.query('DELETE FROM documents WHERE id = ?');

function filtered(params: URLSearchParams) {
  const project = params.get('project');
  if (project) {
    return db
      .query(
        'SELECT id, title, slug, project, created_at, updated_at FROM documents WHERE project = ? ORDER BY updated_at DESC'
      )
      .all(project);
  }
  return list.all();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const documentRoutes = {
  '/api/documents': {
    GET: (req: Request) => {
      const params = new URL(req.url).searchParams;
      return Response.json(filtered(params));
    },
    POST: async (req: Request) => {
      const body = await req.json();
      if (!body.title) {
        return Response.json({ error: 'title is required' }, { status: 400 });
      }
      const slug = body.slug || slugify(body.title);
      try {
        const result = insert.run({
          $title: body.title,
          $slug: slug,
          $body: body.body || '',
          $project: body.project || '',
        });
        return Response.json(getById.get(result.lastInsertRowid), { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/documents/:id': {
    GET: (req: Request & { params: { id: string } }) => {
      const row = getById.get(Number(req.params.id));
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(row);
    },
    PUT: async (req: Request & { params: { id: string } }) => {
      const existing = getById.get(Number(req.params.id)) as any;
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      const body = await req.json();
      try {
        update.run({
          $id: Number(req.params.id),
          $title: body.title ?? existing.title,
          $slug: body.slug ?? existing.slug,
          $body: body.body ?? existing.body,
          $project: body.project ?? existing.project,
        });
        return Response.json(getById.get(Number(req.params.id)));
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
    DELETE: (req: Request & { params: { id: string } }) => {
      const existing = getById.get(Number(req.params.id));
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      remove.run(Number(req.params.id));
      return new Response(null, { status: 204 });
    },
  },
};
