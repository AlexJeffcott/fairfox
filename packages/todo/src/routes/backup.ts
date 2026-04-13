import db from '../db';

export const backupRoutes = {
  '/api/backup': {
    GET: () => {
      const backup = {
        exported_at: new Date().toISOString(),
        projects: db.query('SELECT * FROM projects ORDER BY sort_order, pid').all(),
        tasks: db.query('SELECT * FROM tasks ORDER BY sort_order, tid').all(),
        to_buy: db.query('SELECT * FROM to_buy ORDER BY sort_order, bid').all(),
        city_home: db.query('SELECT * FROM city_home ORDER BY sort_order, hid').all(),
        directories: db.query('SELECT * FROM directories ORDER BY sort_order, dir').all(),
        quick_capture: db.query('SELECT * FROM quick_capture ORDER BY id').all(),
        documents: db.query('SELECT * FROM documents ORDER BY updated_at DESC').all(),
      };
      return Response.json(backup);
    },
  },
};
