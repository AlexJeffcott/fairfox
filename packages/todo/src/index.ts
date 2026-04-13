import type { WsData } from '@fairfox/shared/subapp';
import type { ServerWebSocket } from 'bun';
import './db.ts';
import { backupRoutes } from './routes/backup.ts';
import { chatRoutes } from './routes/chat.ts';
import { cityHomeRoutes } from './routes/city-home.ts';
import { directoryRoutes } from './routes/directories.ts';
import { documentRoutes } from './routes/documents.ts';
import { projectRoutes } from './routes/projects.ts';
import { quickCaptureRoutes } from './routes/quick-capture.ts';
import { taskRoutes } from './routes/tasks.ts';
import { toBuyRoutes } from './routes/to-buy.ts';
import { addClient, hasRelay, removeClient } from './ws.ts';

export const mount = '/todo' as const;
export const wsPath = '/todo/ws' as const;

const BASE_PATH = '/todo';
const buildCache = new Map<string, { content: ArrayBuffer; type: string }>();
let entryFile = '';
let cssFile = '';

async function buildFrontend(): Promise<void> {
  console.log('[todo] building frontend');
  buildCache.clear();

  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/frontend/main.tsx`],
    target: 'browser',
    minify: process.env.NODE_ENV === 'production',
    splitting: true,
    naming: {
      entry: '[name].[hash].[ext]',
      chunk: '[name].[hash].[ext]',
      asset: '[name].[hash].[ext]',
    },
  });

  if (!result.success) {
    console.error('[todo] build failed:', result.logs);
    throw new Error('todo frontend build failed');
  }

  for (const output of result.outputs) {
    const name = output.path.split('/').pop() ?? '';
    const content = await output.arrayBuffer();
    const type = name.endsWith('.js')
      ? 'application/javascript'
      : name.endsWith('.css')
        ? 'text/css'
        : 'application/octet-stream';
    buildCache.set(name, { content, type });

    if (output.kind === 'entry-point') {
      entryFile = name;
    }
  }

  const cssResult = await Bun.build({
    entrypoints: [`${import.meta.dir}/frontend/styles.css`],
    target: 'browser',
    minify: process.env.NODE_ENV === 'production',
    naming: '[name].[hash].[ext]',
  });

  if (cssResult.success) {
    for (const output of cssResult.outputs) {
      const name = output.path.split('/').pop() ?? '';
      buildCache.set(name, {
        content: await output.arrayBuffer(),
        type: 'text/css',
      });
      cssFile = name;
    }
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TODO</title>
  <link rel="stylesheet" href="${BASE_PATH}/assets/${cssFile}">
  <script>window.BASE_PATH=${JSON.stringify(BASE_PATH)};</script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${BASE_PATH}/assets/${entryFile}"></script>
</body>
</html>`;

  const htmlBytes = new TextEncoder().encode(htmlContent);
  const htmlBuffer = new ArrayBuffer(htmlBytes.byteLength);
  new Uint8Array(htmlBuffer).set(htmlBytes);
  buildCache.set('index.html', {
    content: htmlBuffer,
    type: 'text/html',
  });

  console.log(`[todo] built — ${buildCache.size} files`);
}

await buildFrontend();

const internal = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  routes: {
    '/health': () => Response.json({ status: 'ok', relay: hasRelay() }),
    ...projectRoutes,
    ...taskRoutes,
    ...toBuyRoutes,
    ...cityHomeRoutes,
    ...directoryRoutes,
    ...quickCaptureRoutes,
    ...backupRoutes,
    ...chatRoutes,
    ...documentRoutes,
  },
  fetch(req) {
    const url = new URL(req.url);

    if (
      url.pathname === '/' ||
      (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/assets/'))
    ) {
      const file = buildCache.get('index.html');
      if (file) {
        return new Response(file.content, {
          headers: { 'Content-Type': file.type },
        });
      }
    }

    if (url.pathname.startsWith('/assets/')) {
      const name = url.pathname.slice('/assets/'.length);
      const file = buildCache.get(name);
      if (file) {
        return new Response(file.content, {
          headers: {
            'Content-Type': file.type,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
});

export async function fetch(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const innerUrl = `http://127.0.0.1:${internal.port}${u.pathname}${u.search}`;
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers: req.headers,
  };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    init.body = req.body;
    init.duplex = 'half';
  }
  return globalThis.fetch(innerUrl, init);
}

export function open(ws: ServerWebSocket<WsData>): void {
  addClient(ws, ws.data.role);
  console.log(`[todo/ws] ${ws.data.role} connected`);
}

export function message(_ws: ServerWebSocket<WsData>, _msg: string | Buffer): void {
  // No-op — todo clients push state via REST, not via WS.
}

export function close(ws: ServerWebSocket<WsData>): void {
  removeClient(ws);
  console.log(`[todo/ws] ${ws.data.role} disconnected`);
}
