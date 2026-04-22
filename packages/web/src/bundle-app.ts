// Build and cache the fairfox mesh SPA bundle at server startup.
//
// The mesh UI ships as one Preact SPA whose entry is
// `packages/home/src/client/boot.tsx`. Bun.build walks its imports,
// produces a JS bundle plus any asset chunks, and hands them back
// as an in-memory manifest the server serves from. This keeps the
// architecture to a single Bun.serve with no separate frontend
// build step and no static file dance in the Dockerfile.
//
// Historically this file built every sub-app's own bundle in a
// loop; Phase 3 collapsed the six mesh sub-apps into the unified
// SPA, so only `home` gets built now. The public asset path stays
// `/home/<name>-<hash>.<ext>` because the SPA still lives in the
// home package.

import { resolve } from 'node:path';

export interface AppBundle {
  readonly name: string;
  readonly html: string;
  readonly artefacts: Map<string, { body: Blob; contentType: string }>;
}

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
export const APP_PACKAGE = 'home';

function htmlShell(entryJs: string, entryCss: string | null, buildHash: string): string {
  const cssLink = entryCss
    ? `    <link rel="stylesheet" href="/${APP_PACKAGE}${entryCss}" />\n`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#b24b1e" />
    <meta name="fairfox-build-hash" content="${buildHash}" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <link rel="apple-touch-icon" href="/icon.svg" />
    <title>fairfox</title>
${cssLink}  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/${APP_PACKAGE}${entryJs}"></script>
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('/sw.js').catch(function () {});
        });
      }
    </script>
  </body>
</html>
`;
}

export async function buildApp(buildHash: string): Promise<AppBundle> {
  const entry = resolve(REPO_ROOT, 'packages', APP_PACKAGE, 'src', 'client', 'boot.tsx');
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    splitting: false,
    minify: false,
    sourcemap: 'linked',
    naming: { entry: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]' },
  });
  if (!result.success) {
    throw new Error(`[bundle-app] build failed:\n${result.logs.map((l) => String(l)).join('\n')}`);
  }

  const artefacts = new Map<string, { body: Blob; contentType: string }>();
  let entryJs = '';
  let entryCss: string | null = null;
  for (const output of result.outputs) {
    const path = output.path.startsWith('./') ? output.path.slice(1) : `/${output.path}`;
    const publicPath = path.startsWith('/') ? path : `/${path}`;
    artefacts.set(publicPath, { body: output, contentType: output.type });
    if (output.kind === 'entry-point') {
      entryJs = publicPath;
    }
    // Bun.build emits CSS collected from CSS module imports as an asset
    // with a .css extension. Pick it up so the HTML shell can <link> it.
    if (output.kind === 'asset' && publicPath.endsWith('.css')) {
      entryCss = publicPath;
    }
  }

  const html = htmlShell(entryJs, entryCss, buildHash);
  return { name: APP_PACKAGE, html, artefacts };
}
