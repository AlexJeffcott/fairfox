// Server for a fairfox sub-app — signaling relay + static file serving.
//
// Under the meshState architecture the server never holds or processes
// sub-app state. Its only roles are:
//   1. WebSocket signaling relay so mesh peers can discover each other
//   2. Serving the client bundle as static files
//   3. Health check endpoint
//
// Copy this file when starting a new sub-app. The only thing to change
// is the static file path if your build output goes somewhere else.

import { fairfoxSignaling } from '@fairfox/shared/signaling';
import { Elysia } from 'elysia';

const PORT = Number(process.env.PORT ?? '3000');

const app = new Elysia()
  .use(fairfoxSignaling)
  .get('/health', () => ({ ok: true }))
  .listen(PORT);

console.log(`[template] listening on :${PORT}`);

export type App = typeof app;
