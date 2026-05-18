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

export const OCTET_STREAM_FALLBACK = 'application/octet-stream';

export function contentTypeFor(name: string): string {
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
  if (name.endsWith('.wasm')) {
    return 'application/wasm';
  }
  return OCTET_STREAM_FALLBACK;
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
    <script>
      // Boot-phase tracer. Installed inline so it survives even when
      // the bundle's module imports hang before any boot.tsx code
      // runs. Each call appends one line to a fixed banner that stays
      // visible through the App's first render. When the page goes
      // blank in production we can ask a user "what's the last line in
      // the green banner?" and translate that straight into the
      // boot-phase that hung.
      window.__mark = function (label) {
        try {
          var log = document.getElementById('__boot_log');
          if (!log) {
            log = document.createElement('div');
            log.id = '__boot_log';
            log.style.cssText =
              'position:fixed;top:0;left:0;right:0;background:#000;color:#0f0;font:14px/1.4 ui-monospace,monospace;padding:6px 10px;z-index:2147483647;max-height:40vh;overflow:auto;white-space:pre-wrap;';
            (document.body || document.documentElement).appendChild(log);
          }
          var t = new Date().toISOString().slice(11, 23);
          var line = document.createElement('div');
          line.textContent = t + ' ' + label;
          log.appendChild(line);
        } catch (e) {
          // best-effort tracer; never throw out of mark
        }
      };
      window.__mark('A: shell inline script ran');

      // Inline fetch tracer. The bundle is hanging on polly's
      // top-level await of initializeWasm before any bundle-side code
      // runs, so the only place we can see what network calls precede
      // the freeze is from a wrapper installed before the bundle
      // script. Each call appends a line to the banner with the URL
      // and how it resolved.
      var origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var url =
          typeof input === 'string'
            ? input
            : input && input.url
              ? input.url
              : String(input);
        var short = url.length > 80 ? url.slice(0, 77) + '...' : url;
        window.__mark('fetch  -> ' + short);
        var started = Date.now();
        return origFetch(input, init).then(
          function (res) {
            window.__mark(
              'fetch ' + res.status + ' ' + (Date.now() - started) + 'ms ' + short
            );
            return res;
          },
          function (err) {
            window.__mark(
              'fetch !! ' + (Date.now() - started) + 'ms ' + short + ' :: ' + err
            );
            throw err;
          }
        );
      };
      window.__mark('A2: fetch tracer installed');

      // WebAssembly tracer. The wasm fetch resolves fine but the
      // bundle still never reaches its first boot.tsx mark, so the
      // freeze is downstream of fetch in WebAssembly instantiate.
      // Wrap both entry points to see when (or whether) they settle.
      if (window.WebAssembly) {
        var W = window.WebAssembly;
        if (typeof W.instantiateStreaming === 'function') {
          var origStreaming = W.instantiateStreaming.bind(W);
          W.instantiateStreaming = function (source, importObject) {
            window.__mark('wasm  -> instantiateStreaming');
            var t0 = Date.now();
            return Promise.resolve(origStreaming(source, importObject)).then(
              function (r) {
                window.__mark('wasm OK instantiateStreaming ' + (Date.now() - t0) + 'ms');
                return r;
              },
              function (err) {
                window.__mark('wasm !! instantiateStreaming ' + (Date.now() - t0) + 'ms :: ' + err);
                throw err;
              }
            );
          };
        }
        if (typeof W.instantiate === 'function') {
          var origInstantiate = W.instantiate.bind(W);
          W.instantiate = function (bytes, importObject) {
            window.__mark('wasm  -> instantiate (bytes=' + (bytes && bytes.byteLength) + ')');
            var t0 = Date.now();
            return Promise.resolve(origInstantiate(bytes, importObject)).then(
              function (r) {
                window.__mark('wasm OK instantiate ' + (Date.now() - t0) + 'ms');
                return r;
              },
              function (err) {
                window.__mark('wasm !! instantiate ' + (Date.now() - t0) + 'ms :: ' + err);
                throw err;
              }
            );
          };
        }
      }
      window.__mark('A3: wasm tracer installed');

      // Heartbeat. If it keeps firing past the last wasm mark, the
      // event loop is still pumping and we're stalled on an unresolved
      // promise. If it stops at the same moment, the main thread is
      // locked in a sync call (most likely wasm.__wbindgen_start).
      var heartbeats = 0;
      setInterval(function () {
        heartbeats++;
        window.__mark('heartbeat ' + heartbeats);
      }, 250);

      // Sync wasm constructors. instantiateStreaming hit OK so the
      // streaming compile finished, but the bundle still never marks
      // B — the only sync work left before B is wasm.__wbindgen_start
      // and the rest of polly's mesh module evaluation. Wrap the
      // synchronous Instance/Module paths to verify the start path
      // isn't taken (it shouldn't be, but rule it out).
      if (window.WebAssembly) {
        var W2 = window.WebAssembly;
        if (typeof W2.Instance === 'function') {
          var origInst = W2.Instance;
          W2.Instance = new Proxy(origInst, {
            construct: function (target, args) {
              window.__mark('wasm  -> new Instance');
              var inst = Reflect.construct(target, args);
              window.__mark('wasm OK new Instance');
              return inst;
            },
          });
        }
        if (typeof W2.Module === 'function') {
          var origMod = W2.Module;
          W2.Module = new Proxy(origMod, {
            construct: function (target, args) {
              window.__mark('wasm  -> new Module');
              var mod = Reflect.construct(target, args);
              window.__mark('wasm OK new Module');
              return mod;
            },
          });
        }
      }
      window.__mark('A4: sync wasm wrappers installed');

      // WebSocket tracer. ensure-mesh.ts opens a top-level mesh
      // connection during module init; that connection includes a
      // signaling WebSocket whose .connect() the bundle awaits.
      // Capture the upgrade, open event, first message, and close so
      // we can see whether the socket ever becomes usable.
      if (typeof window.WebSocket === 'function') {
        var OrigWS = window.WebSocket;
        function TracedWS(url, protocols) {
          var ws =
            protocols === undefined
              ? new OrigWS(url)
              : new OrigWS(url, protocols);
          var shortUrl = String(url).slice(-60);
          window.__mark('ws  -> open ' + shortUrl);
          var t0 = Date.now();
          ws.addEventListener('open', function () {
            window.__mark('ws OK ' + (Date.now() - t0) + 'ms ' + shortUrl);
          });
          ws.addEventListener('error', function () {
            window.__mark('ws !! error after ' + (Date.now() - t0) + 'ms ' + shortUrl);
          });
          ws.addEventListener('close', function (e) {
            window.__mark(
              'ws .. close ' + e.code + ' after ' + (Date.now() - t0) + 'ms ' + shortUrl
            );
          });
          ws.addEventListener('message', function (e) {
            var d = e.data;
            var preview =
              typeof d === 'string'
                ? d.slice(0, 60)
                : '[binary ' + (d && d.byteLength) + 'b]';
            window.__mark('ws <- msg ' + preview);
          });
          return ws;
        }
        TracedWS.prototype = OrigWS.prototype;
        TracedWS.CONNECTING = OrigWS.CONNECTING;
        TracedWS.OPEN = OrigWS.OPEN;
        TracedWS.CLOSING = OrigWS.CLOSING;
        TracedWS.CLOSED = OrigWS.CLOSED;
        window.WebSocket = TracedWS;
      }
      window.__mark('A5: WebSocket tracer installed');
    </script>
    <script type="module" src="/home${entryJs}"></script>
    <script>
      // Service worker registration is paused while the kill-switch
      // sw.js (which unregisters itself and reloads clients) is in
      // rotation. Re-enable here once the next worker generation is
      // ready and the old caches have rolled out everywhere.
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

/** Read a locally-built bundle from a file path (dev workflow).
 * Set `FAIRFOX_LOCAL_BUNDLE=/absolute/path/to/fairfox-web.zip` to
 * bypass the GitHub fetch entirely — useful for verifying an
 * uncommitted SPA change against a real mesh before tagging a
 * web-v* release. Returns null if the env var is unset or the file
 * can't be read. */
function loadFromLocalEnv(): { bytes: Uint8Array; tag: string } | null {
  const path = process.env.FAIRFOX_LOCAL_BUNDLE;
  if (!path) {
    return null;
  }
  if (!existsSync(path)) {
    console.error(`[fetch-app] FAIRFOX_LOCAL_BUNDLE=${path} does not exist`);
    return null;
  }
  try {
    return {
      bytes: new Uint8Array(readFileSync(path)),
      tag: `local:${path.split('/').pop() ?? 'bundle'}`,
    };
  } catch (err) {
    console.error(
      `[fetch-app] FAIRFOX_LOCAL_BUNDLE read failed: ${err instanceof Error ? err.message : err}`
    );
    return null;
  }
}

/** Fetch the newest `web-v*` release's bundle, fall back to the
 * last good disk copy, and unpack into an AppBundle. Never throws
 * — a null return means "no bundle available; server should 503". */
export async function fetchApp(): Promise<AppBundle | null> {
  const local = loadFromLocalEnv();
  if (local) {
    try {
      console.log(`[fetch-app] using local bundle (${local.tag})`);
      return bundleFromZip(local.bytes, local.tag);
    } catch (err) {
      console.error(
        `[fetch-app] local zip parse failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }
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
