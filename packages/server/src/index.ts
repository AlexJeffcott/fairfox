import { Elysia } from 'elysia';
import { check3Routes } from './check3.ts';
import { readConfig, type Settings } from './config.ts';
import { openDatabase } from './database.ts';

export { SETTINGS, type Settings } from './config.ts';

/** The routes of the class `public` (I18a): they need no session. */
function publicRoutes(commit: string) {
  return new Elysia().get('/version', () => ({ commit }));
}

/**
 * The Fairfox server. It reads its settings and does not start when one is
 * missing (C1), opens its database and brings it to the latest migration
 * (S7, C6), and holds its routes. The caller listens: main.ts in the image,
 * the @local steps in their process. Step 0b adds no business logic: the one
 * route is the version (C5), and no route reads the database yet.
 */
export function createApp(settings: Settings) {
  const config = readConfig(settings);
  const { database } = openDatabase(config.databasePath);
  // Step 0c only: the bare page of check 3. The last deploy of 0c removes it (L2).
  const routes = new Elysia().use(publicRoutes(config.commit)).use(check3Routes(config.turnSecret));
  // Stryker disable next-line ArrowFunction: no route reads the database yet, so its close cannot be seen from outside
  return routes.onStop(() => database.close());
}

export type App = ReturnType<typeof createApp>;
