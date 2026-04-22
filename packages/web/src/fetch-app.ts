// Fetch + cache the fairfox SPA bundle from a GitHub Release.
//
// UI changes ship with `git tag web-v<X>.<Y>.<Z> && git push --tags`;
// the `web-release.yml` workflow builds the tarball and attaches it
// to the release. Railway's server calls `fetchApp()` at startup to
// pull the tarball and extract it into an in-memory AppBundle. A
// `/admin/refresh-web-bundle` endpoint lets an operator swap in the
// newest release without a Railway restart.
//
// Cold start: if the network fetch fails (GitHub down, rate limits),
// we fall back to a disk cache at `${DATA_DIR}/fairfox-web.zip` so
// Railway always has SOMETHING to serve.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

export interface AppBundle {
  readonly tag: string;
  readonly html: string;
  readonly artefacts: Map<string, { body: Uint8Array; contentType: string }>;
}

const OWNER = 'AlexJeffcott';
const REPO = 'fairfox';
const TAG_PREFIX = 'web-';
const LATEST_ASSET_URL = `https://github.com/${OWNER}/${REPO}/releases/latest/download/fairfox-web.zip`;
const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;

function contentTypeFor(name: string): string {
  if (name.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (name.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (name.endsWith('.map')) {
    return 'application/json; charset=utf-8';
  }
  if (name.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  return 'application/octet-stream';
}

function htmlShell(entryJs: string, entryCss: string | null, buildHash: string): string {
  const cssLink = entryCss ? `    <link rel="stylesheet" href="/home${entryCss}" />\n` : '';
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
    <script type="module" src="/home${entryJs}"></script>
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

function bundleFromZip(zipBytes: Uint8Array, tag: string): AppBundle {
  const entries = unzipSync(zipBytes);
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) {
    throw new Error('web bundle: manifest.json missing from zip');
  }
  const manifest: { entryJs?: string; entryCss?: string | null } = JSON.parse(
    new TextDecoder().decode(manifestBytes)
  );
  const entryJs = manifest.entryJs;
  if (typeof entryJs !== 'string' || !entryJs) {
    throw new Error('web bundle: manifest missing entryJs');
  }
  const entryCss =
    typeof manifest.entryCss === 'string' && manifest.entryCss ? manifest.entryCss : null;

  const artefacts = new Map<string, { body: Uint8Array; contentType: string }>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name === 'manifest.json') {
      continue;
    }
    artefacts.set(`/${name}`, { body: bytes, contentType: contentTypeFor(name) });
  }
  return {
    tag,
    html: htmlShell(entryJs, entryCss, tag),
    artefacts,
  };
}

async function fetchLatestTag(): Promise<string | undefined> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      return undefined;
    }
    const parsed: unknown = await res.json();
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    for (const entry of parsed) {
      if (typeof entry === 'object' && entry !== null) {
        const rec = entry as Record<string, unknown>;
        const tag = rec.tag_name;
        if (typeof tag === 'string' && tag.startsWith(TAG_PREFIX)) {
          return tag;
        }
      }
    }
  } catch {
    // fall through — caller uses 'unknown' as the tag label
  }
  return undefined;
}

async function fetchZipBytes(): Promise<Uint8Array | undefined> {
  try {
    const res = await fetch(LATEST_ASSET_URL);
    if (!res.ok) {
      return undefined;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

function diskCachePath(): string | undefined {
  const dir = process.env.DATA_DIR;
  if (!dir) {
    return undefined;
  }
  return join(dir, 'fairfox-web.zip');
}

function loadFromDisk(): Uint8Array | undefined {
  const path = diskCachePath();
  if (!path || !existsSync(path)) {
    return undefined;
  }
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return undefined;
  }
}

function saveToDisk(bytes: Uint8Array): void {
  const path = diskCachePath();
  if (!path) {
    return;
  }
  try {
    writeFileSync(path, bytes);
  } catch {
    // best-effort
  }
}

/** Fetch the newest `web-v*` release's bundle, fall back to the
 * last good disk copy, and unpack into an AppBundle. Never throws
 * — a null return means "no bundle available; server should 503". */
export async function fetchApp(): Promise<AppBundle | null> {
  const [tag, zipBytes] = await Promise.all([fetchLatestTag(), fetchZipBytes()]);
  if (zipBytes) {
    saveToDisk(zipBytes);
    try {
      return bundleFromZip(zipBytes, tag ?? 'latest');
    } catch (err) {
      console.error(
        `[fetch-app] live zip parse failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  const disk = loadFromDisk();
  if (disk) {
    try {
      return bundleFromZip(disk, tag ?? 'cached');
    } catch (err) {
      console.error(
        `[fetch-app] disk zip parse failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  return null;
}
