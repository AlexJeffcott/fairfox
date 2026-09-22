import { Database } from 'bun:sqlite';
import { Elysia } from 'elysia';
import { readConfig, type Settings } from './config.ts';

export { SETTINGS, type Settings } from './config.ts';

/** The routes of the class `public` (I18a): they need no session. */
function publicRoutes(commit: string) {
  return new Elysia({ name: 'public' }).get('/version', () => ({ commit }));
}

/**
 * The Fairfox server. It reads its settings and does not start when one is
 * missing (C1), opens its database, and holds its routes. The caller listens.
 * Step 0a adds no business logic: the one route is the version (C5), and
 * nothing reads the database yet.
 */
export function createApp(settings: Settings) {
  const config = readConfig(settings);
  const database = new Database(config.databasePath, { strict: true });
  return new Elysia().use(publicRoutes(config.commit)).onStop(() => database.close());
}

export type App = ReturnType<typeof createApp>;
