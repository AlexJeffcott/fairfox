// Build and cache a mesh sub-app's client bundle at server startup.
//
// Each mesh sub-app ships a src/client/boot.tsx as its single entry
// point. Bun.build walks its imports, produces a JS bundle plus any
// asset chunks, and hands them back as an in-memory manifest. The
// bundler runs once per sub-app at server startup so that subsequent
// requests serve from the cached blobs rather than rebuilding.
//
// This keeps the architecture to a single Bun.serve with no separate
// frontend build step and no static file dance in the Dockerfile.

import { resolve } from 'node:path';

export interface SubAppBundle {
  readonly name: string;
  readonly html: string;
  readonly artefacts: Map<string, { body: Blob; contentType: string }>;
}

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');

function htmlShell(
  name: string,
  entryJs: string,
  entryCss: string | null,
  buildHash: string
): string {
  const cssLink = entryCss ? `    <link rel="stylesheet" href="/${name}${entryCss}" />\n` : '';
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
    <title>fairfox · ${name}</title>
${cssLink}  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/${name}${entryJs}"></script>
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

export async function buildSubApp(name: string, buildHash: string): Promise<SubAppBundle> {
  const entry = resolve(REPO_ROOT, 'packages', name, 'src', 'client', 'boot.tsx');
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
    throw new Error(
      `[bundle-subapp] ${name} build failed:\n${result.logs.map((l) => String(l)).join('\n')}`
    );
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

  const html = htmlShell(name, entryJs, entryCss, buildHash);
  return { name, html, artefacts };
}

export async function buildAllSubApps(
  names: readonly string[],
  buildHash: string
): Promise<Map<string, SubAppBundle>> {
  const bundles = new Map<string, SubAppBundle>();
  for (const name of names) {
    try {
      const bundle = await buildSubApp(name, buildHash);
      bundles.set(name, bundle);
      console.log(`[bundle-subapp] ${name}: ${bundle.artefacts.size} artefact(s) ready`);
    } catch (err) {
      console.error(`[bundle-subapp] ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return bundles;
}
