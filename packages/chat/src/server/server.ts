// Server for the chat sub-app — signaling relay only. All chat state
// lives in the `chat:main` $meshState document and replicates over
// WebRTC; the server is a dumb relay like every other sub-app.

import { fairfoxSignaling } from '@fairfox/shared/signaling';
import { Elysia } from 'elysia';

const PORT = Number(process.env.PORT ?? '3000');

const app = new Elysia()
  .use(fairfoxSignaling)
  .get('/health', () => ({ ok: true }))
  .listen(PORT);

console.log(`[chat] listening on :${PORT}`);

export type App = typeof app;
