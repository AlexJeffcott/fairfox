// Server for the docs sub-app — signaling relay only. All docs state
// lives in the `docs:main` $meshState document and replicates over
// WebRTC; the server is a dumb relay like every other sub-app.

import { fairfoxSignaling } from '@fairfox/shared/signaling';
import { Elysia } from 'elysia';

const PORT = Number(process.env.PORT ?? '3000');

const app = new Elysia()
  .use(fairfoxSignaling)
  .get('/health', () => ({ ok: true }))
  .listen(PORT);

console.log(`[docs] listening on :${PORT}`);

export type App = typeof app;
