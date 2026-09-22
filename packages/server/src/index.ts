import { Elysia } from 'elysia';

/** The Fairfox server. It has no routes: step 0a adds no business logic. */
export function createApp() {
  return new Elysia();
}

export type App = ReturnType<typeof createApp>;
