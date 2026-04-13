import { readFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { staticPlugin } from '@elysiajs/static';
import { openDb } from '@fairfox/shared/openDb';
import { Elysia, t } from 'elysia';
import { exportChapter, play, setDb } from './engine.ts';
import { bind } from './lib/bind.ts';
import { runMigrations } from './lib/db.ts';

const PACKAGE_DIR = join(import.meta.dir, '..');
const PUBLIC_DIR = join(PACKAGE_DIR, 'public');
const BASE_PATH = '/struggle';

const rawIndexHtml = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf-8');
const indexHtml = rawIndexHtml.replace(
  '</head>',
  `<script>window.BASE_PATH=${JSON.stringify(BASE_PATH)};</script></head>`
);

const db = openDb('struggle');
runMigrations(db);
setDb(db);

const app = new Elysia()
  .get('/api/health', () => ({ ok: true }))
  .post(
    '/api/play',
    async ({ body }) => {
      try {
        return await play(body.action, body.target ?? null, body.state ?? null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: msg };
      }
    },
    {
      body: t.Object({
        action: t.String(),
        target: t.Optional(t.String()),
        state: t.Optional(t.Any()),
      }),
    }
  )
  .post(
    '/api/feedback',
    ({ body }) => {
      db.run(
        `INSERT INTO feedback (chapter_id, passage_id, paragraph_id, paragraph_text, comment, game_state)
         VALUES ($ch, $pid, $paraid, $pt, $comment, $state)`,
        bind({
          $ch: body.chapter,
          $pid: body.passage,
          $paraid: body.paragraphId ?? null,
          $pt: body.paragraphText || null,
          $comment: body.comment || null,
          $state: JSON.stringify(body.state),
        })
      );
      return { ok: true };
    },
    {
      body: t.Object({
        chapter: t.String(),
        passage: t.String(),
        paragraphId: t.Optional(t.Number()),
        paragraphText: t.Optional(t.String()),
        comment: t.Optional(t.String()),
        state: t.Any(),
      }),
    }
  )
  .get('/api/feedback', ({ query }) => {
    const chapter = query.chapter;
    if (chapter) {
      return db
        .query('SELECT * FROM feedback WHERE chapter_id = $ch ORDER BY created_at DESC')
        .all(bind({ $ch: chapter }));
    }
    return db.query('SELECT * FROM feedback ORDER BY created_at DESC').all();
  })
  .get('/api/backup/:chapter', ({ params }) => {
    const data = exportChapter(params.chapter);
    if (!data) {
      return { error: 'Chapter not found' };
    }
    return data;
  })
  .get('/api/backup/db', () => {
    const bytes = db.serialize();
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename=app.db',
      },
    });
  })
  .get('/api/backup/full', () => {
    const chapters = db.query('SELECT * FROM chapters').all();
    const passages = db.query('SELECT * FROM passages').all();
    const content = db.query('SELECT * FROM passage_content').all();
    const choices = db.query('SELECT * FROM choices').all();
    const litanies = db.query('SELECT * FROM litanies').all();
    const placeNames = db.query('SELECT * FROM place_names').all();
    const refs = db.query('SELECT * FROM refs').all();
    const feedback = db.query('SELECT * FROM feedback').all();
    const rewrites = db.query('SELECT * FROM rewrites').all();
    return {
      exported_at: new Date().toISOString(),
      chapters,
      passages,
      passage_content: content,
      choices,
      litanies,
      place_names: placeNames,
      refs,
      feedback,
      rewrites,
    };
  })
  .get('/api/place-names/:chapter', ({ params }) => {
    return db
      .query('SELECT passage_id, name FROM place_names WHERE chapter_id = $ch')
      .all(bind({ $ch: params.chapter }));
  })
  .post(
    '/api/place-names',
    ({ body }) => {
      db.run(
        `INSERT OR REPLACE INTO place_names (passage_id, chapter_id, name)
         VALUES ($pid, $ch, $name)`,
        bind({ $pid: body.passageId, $ch: body.chapter, $name: body.name })
      );
      return { ok: true };
    },
    {
      body: t.Object({
        chapter: t.String(),
        passageId: t.String(),
        name: t.String(),
      }),
    }
  )
  .post(
    '/api/place-names/delete',
    ({ body }) => {
      db.run(
        'DELETE FROM place_names WHERE passage_id = $pid AND chapter_id = $ch',
        bind({
          $pid: body.passageId,
          $ch: body.chapter,
        })
      );
      return { ok: true };
    },
    {
      body: t.Object({
        chapter: t.String(),
        passageId: t.String(),
      }),
    }
  )
  .get('/api/passage-text/:chapter/:passage', ({ params }) => {
    const rows = db
      .query(
        `SELECT context, html FROM passage_content
         WHERE passage_id = $pid AND chapter_id = $ch
         ORDER BY context`
      )
      .all(bind({ $pid: params.passage, $ch: params.chapter })) as Array<{
      context: string;
      html: string;
    }>;

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.context] = row.html;
    }
    return result;
  })
  .post(
    '/api/passage-text',
    ({ body }) => {
      const run = db.transaction(() => {
        const old = db
          .query(
            `SELECT html FROM passage_content
             WHERE passage_id = $pid AND chapter_id = $ch AND context = $ctx`
          )
          .get(bind({ $pid: body.passageId, $ch: body.chapter, $ctx: body.context })) as {
          html: string;
        } | null;

        const oldHtml = old?.html || '';
        if (oldHtml !== body.text) {
          db.run(
            `INSERT INTO rewrites (chapter_id, passage_id, paragraph_id, old_text, new_text)
             VALUES ($ch, $pid, NULL, $old, $new)`,
            bind({ $ch: body.chapter, $pid: body.passageId, $old: oldHtml, $new: body.text })
          );
        }

        db.run(
          `INSERT INTO passage_content (passage_id, chapter_id, context, html)
           VALUES ($pid, $ch, $ctx, $html)
           ON CONFLICT (passage_id, chapter_id, context)
           DO UPDATE SET html = $html`,
          bind({
            $pid: body.passageId,
            $ch: body.chapter,
            $ctx: body.context,
            $html: body.text,
          })
        );
      });
      run();
      return { ok: true };
    },
    {
      body: t.Object({
        chapter: t.String(),
        passageId: t.String(),
        context: t.String(),
        text: t.String(),
      }),
    }
  )
  .get('/api/passages/:chapter', ({ params }) => {
    const passages = db
      .query('SELECT * FROM passages WHERE chapter_id = $ch')
      .all(bind({ $ch: params.chapter })) as Array<{
      id: string;
      type: string | null;
      next: string | null;
      condition: string | null;
      death: string | null;
      is_end: number;
      is_title_page: number;
      is_inspection: number;
    }>;
    return passages.map((p) => ({
      id: p.id,
      type: p.type,
      next: p.next,
      condition: p.condition,
      death: p.death,
      isEnd: !!p.is_end,
      isTitlePage: !!p.is_title_page,
      isInspection: !!p.is_inspection,
    }));
  })
  .post(
    '/api/passage',
    ({ body }) => {
      db.run(
        `INSERT OR REPLACE INTO passages
         (id, chapter_id, type, next, set_vars, condition, death, is_end, is_title_page, is_inspection)
         VALUES ($id, $ch, $type, $next, $set, $cond, $death, $end, $title, $insp)`,
        bind({
          $id: body.id,
          $ch: body.chapter,
          $type: body.type || null,
          $next: body.next || null,
          $set: body.setVars ? JSON.stringify(body.setVars) : null,
          $cond: body.condition || null,
          $death: body.death || null,
          $end: body.isEnd ? 1 : 0,
          $title: body.isTitlePage ? 1 : 0,
          $insp: body.isInspection ? 1 : 0,
        })
      );
      return { ok: true };
    },
    {
      body: t.Object({
        id: t.String(),
        chapter: t.String(),
        type: t.Optional(t.String()),
        next: t.Optional(t.String()),
        setVars: t.Optional(t.Any()),
        condition: t.Optional(t.String()),
        death: t.Optional(t.String()),
        isEnd: t.Optional(t.Boolean()),
        isTitlePage: t.Optional(t.Boolean()),
        isInspection: t.Optional(t.Boolean()),
      }),
    }
  )
  .post(
    '/api/choice',
    ({ body }) => {
      const max = db
        .query(
          'SELECT MAX(sort_order) as m FROM choices WHERE passage_id = $pid AND chapter_id = $ch AND context = $ctx'
        )
        .get(bind({ $pid: body.passageId, $ch: body.chapter, $ctx: body.context || 'body' })) as {
        m: number | null;
      } | null;
      const result = db.run(
        `INSERT INTO choices (passage_id, chapter_id, context, label, target, type, sort_order)
         VALUES ($pid, $ch, $ctx, $label, $target, $type, $sort)`,
        bind({
          $pid: body.passageId,
          $ch: body.chapter,
          $ctx: body.context || 'body',
          $label: body.label,
          $target: body.target,
          $type: body.type || 'navigate',
          $sort: (max?.m ?? -1) + 1,
        })
      );
      return { ok: true, id: Number(result.lastInsertRowid) };
    },
    {
      body: t.Object({
        chapter: t.String(),
        passageId: t.String(),
        label: t.String(),
        target: t.String(),
        type: t.Optional(t.String()),
        context: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/api/choice/delete',
    ({ body }) => {
      db.run('DELETE FROM choices WHERE id = $id', bind({ $id: body.id }));
      return { ok: true };
    },
    {
      body: t.Object({ id: t.Number() }),
    }
  )
  .post(
    '/api/litany',
    ({ body }) => {
      db.run(
        `INSERT OR REPLACE INTO litanies (id, passage_id, chapter_id, excerpt)
         VALUES ($id, $pid, $ch, $excerpt)`,
        bind({ $id: body.id, $pid: body.passageId, $ch: body.chapter, $excerpt: body.excerpt })
      );
      return { ok: true };
    },
    {
      body: t.Object({
        id: t.String(),
        chapter: t.String(),
        passageId: t.String(),
        excerpt: t.String(),
      }),
    }
  )
  .post(
    '/api/litany/delete',
    ({ body }) => {
      db.run('DELETE FROM litanies WHERE id = $id', bind({ $id: body.id }));
      return { ok: true };
    },
    {
      body: t.Object({ id: t.String() }),
    }
  )
  .get('/api/refs', ({ query }) => {
    let sql = 'SELECT id, title, author, form, tags, created_at FROM refs';
    const sqlParams: Record<string, string> = {};
    const conditions: string[] = [];

    if (query.form) {
      conditions.push('form = $form');
      sqlParams.$form = query.form;
    }
    if (query.tag) {
      conditions.push('tags LIKE $tag');
      sqlParams.$tag = `%"${query.tag}"%`;
    }
    if (query.search) {
      conditions.push('(title LIKE $search OR author LIKE $search OR body LIKE $search)');
      sqlParams.$search = `%${query.search}%`;
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY title';
    return db.query(sql).all(bind(sqlParams));
  })
  .get('/api/refs/:id', ({ params }) => {
    return (
      db.query('SELECT * FROM refs WHERE id = $id').get(bind({ $id: params.id })) || {
        error: 'Not found',
      }
    );
  })
  .post(
    '/api/refs',
    ({ body }) => {
      const result = db.run(
        `INSERT INTO refs (title, author, form, tags, body, notes)
         VALUES ($title, $author, $form, $tags, $body, $notes)`,
        bind({
          $title: body.title,
          $author: body.author || null,
          $form: body.form || 'prose',
          $tags: JSON.stringify(body.tags || []),
          $body: body.body || '',
          $notes: body.notes || null,
        })
      );
      return { ok: true, id: Number(result.lastInsertRowid) };
    },
    {
      body: t.Object({
        title: t.String(),
        author: t.Optional(t.String()),
        form: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        body: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/api/refs/update',
    ({ body }) => {
      const fields: string[] = [];
      const sqlParams: Record<string, string | number> = { $id: body.id };
      if (body.title !== undefined) {
        fields.push('title = $title');
        sqlParams.$title = body.title;
      }
      if (body.author !== undefined) {
        fields.push('author = $author');
        sqlParams.$author = body.author;
      }
      if (body.form !== undefined) {
        fields.push('form = $form');
        sqlParams.$form = body.form;
      }
      if (body.tags !== undefined) {
        fields.push('tags = $tags');
        sqlParams.$tags = JSON.stringify(body.tags);
      }
      if (body.body !== undefined) {
        fields.push('body = $body');
        sqlParams.$body = body.body;
      }
      if (body.notes !== undefined) {
        fields.push('notes = $notes');
        sqlParams.$notes = body.notes;
      }
      if (fields.length === 0) {
        return { ok: false, error: 'Nothing to update' };
      }
      db.run(`UPDATE refs SET ${fields.join(', ')} WHERE id = $id`, bind(sqlParams));
      return { ok: true };
    },
    {
      body: t.Object({
        id: t.Number(),
        title: t.Optional(t.String()),
        author: t.Optional(t.String()),
        form: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        body: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/api/refs/delete',
    ({ body }) => {
      db.run('DELETE FROM refs WHERE id = $id', bind({ $id: body.id }));
      return { ok: true };
    },
    {
      body: t.Object({ id: t.Number() }),
    }
  )
  .get('/api/docs', async () => {
    const DOC_DIRS = ['world', 'structure', 'interface'] as const;
    const files: Array<{ path: string; size: number; modified: string }> = [];

    async function scan(absDir: string, pkgRoot: string): Promise<void> {
      const entries = await readdir(absDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(absDir, entry.name);
        if (entry.isDirectory()) {
          await scan(full, pkgRoot);
        } else if (entry.name.endsWith('.md')) {
          const s = await stat(full);
          files.push({
            path: relative(pkgRoot, full),
            size: s.size,
            modified: s.mtime.toISOString(),
          });
        }
      }
    }

    for (const d of DOC_DIRS) {
      const abs = join(PACKAGE_DIR, d);
      try {
        await scan(abs, PACKAGE_DIR);
      } catch {
        // directory missing — skip
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  })
  .get('/api/docs/*', async ({ params }) => {
    const wildcard = params['*'];
    if (!wildcard || wildcard.includes('..')) {
      return { error: 'Invalid path' };
    }
    const abs = join(PACKAGE_DIR, wildcard);
    try {
      const content = await readFile(abs, 'utf-8');
      return { path: wildcard, content };
    } catch {
      return { error: 'Not found' };
    }
  })
  .post(
    '/api/docs/update',
    async ({ body }) => {
      if (!body.path || body.path.includes('..')) {
        return { error: 'Invalid path' };
      }
      if (!body.path.endsWith('.md')) {
        return { error: 'Only .md files' };
      }
      const abs = join(PACKAGE_DIR, body.path);
      try {
        await writeFile(abs, body.content, 'utf-8');
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: msg };
      }
    },
    {
      body: t.Object({
        path: t.String(),
        content: t.String(),
      }),
    }
  )
  .use(
    staticPlugin({
      assets: PUBLIC_DIR,
      prefix: '/',
      indexHTML: false,
    })
  )
  .get(
    '/',
    () =>
      new Response(indexHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
  );

export const mount = '/struggle' as const;

export async function fetch(req: Request): Promise<Response> {
  return app.handle(req);
}
