// The test server of the @browser features. It serves the built files of the
// shell, `packages/shell/dist/`, the way the web part of the one server will
// from the UI on (A2, item 8): the page at `/`, each other file at its own
// path. The web part is not built until the UI, so this server belongs to the
// test harness and not to the server package. It listens on 127.0.0.1 on a
// port the system picks, one server for each scenario.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The built shell, from `devctl build shell`. */
export const SHELL_DIST = fileURLToPath(new URL('../../packages/shell/dist/', import.meta.url));

export type Served = {
  origin: string;
  stop: () => Promise<void>;
};

export function serveShell(): Served {
  if (!existsSync(resolve(SHELL_DIST, 'index.html'))) {
    throw new Error(`The shell is not built: ${SHELL_DIST}index.html does not exist. Run devctl build shell.`);
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      const path = resolve(SHELL_DIST, pathname === '/' ? 'index.html' : `.${decodeURIComponent(pathname)}`);
      const file = Bun.file(path);
      // SHELL_DIST ends with a separator, so a path that escapes it does not start with it.
      if (!path.startsWith(SHELL_DIST) || !(await file.exists())) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(file);
    },
  });
  return { origin: server.url.origin, stop: () => server.stop(true) };
}
