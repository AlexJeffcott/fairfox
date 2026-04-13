import db from '../db';

const list = db.query('SELECT * FROM to_buy ORDER BY sort_order, bid');
const getOne = db.query('SELECT * FROM to_buy WHERE bid = ?');
const insert = db.query(`
  INSERT INTO to_buy (bid, item, status, price, vendor, date, notes, detail, sort_order)
  VALUES ($bid, $item, $status, $price, $vendor, $date, $notes, $detail, $sort_order)
`);
const update = db.prepare(`
  UPDATE to_buy SET
    item = $item, status = $status, price = $price, vendor = $vendor,
    date = $date, notes = $notes, detail = $detail,
    sort_order = $sort_order, updated_at = datetime('now')
  WHERE bid = $bid
`);
const remove = db.query('DELETE FROM to_buy WHERE bid = ?');

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
    .query(`SELECT * FROM to_buy WHERE ${clauses.join(' AND ')} ORDER BY sort_order, bid`)
    .all(...values);
}

export const toBuyRoutes = {
  '/api/to-buy': {
    GET: (req: Request) => {
      const params = new URL(req.url).searchParams;
      return Response.json(filtered(params));
    },
    POST: async (req: Request) => {
      const body = await req.json();
      try {
        insert.run({
          $bid: body.bid,
          $item: body.item,
          $status: body.status || 'researching',
          $price: body.price || '',
          $vendor: body.vendor || '',
          $date: body.date || '',
          $notes: body.notes || '',
          $detail: body.detail || '',
          $sort_order: body.sort_order ?? 0,
        });
        return Response.json(getOne.get(body.bid), { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/to-buy/:bid': {
    GET: (req: Request & { params: { bid: string } }) => {
      const row = getOne.get(req.params.bid);
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(row);
    },
    PUT: async (req: Request & { params: { bid: string } }) => {
      const existing = getOne.get(req.params.bid) as any;
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      const body = await req.json();
      try {
        update.run({
          $bid: req.params.bid,
          $item: body.item ?? existing.item,
          $status: body.status ?? existing.status,
          $price: body.price ?? existing.price,
          $vendor: body.vendor ?? existing.vendor,
          $date: body.date ?? existing.date,
          $notes: body.notes ?? existing.notes,
          $detail: body.detail ?? existing.detail,
          $sort_order: body.sort_order ?? existing.sort_order,
        });
        return Response.json(getOne.get(req.params.bid));
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
    DELETE: (req: Request & { params: { bid: string } }) => {
      const existing = getOne.get(req.params.bid);
      if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
      remove.run(req.params.bid);
      return new Response(null, { status: 204 });
    },
  },
};
