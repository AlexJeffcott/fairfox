// `fairfox update` + the post-command update-check banner.
//
// CLI bundles are published as GitHub Release assets on the repo, so
// a CLI change doesn't need a Railway deploy at all — a git tag
// triggers the `cli-release` workflow which attaches
// `fairfox.js` to the corresponding release, and this command pulls
// from there.
//
//   fairfox update       explicit: fetch latest release, compare
//                         tag against the version baked into this
//                         bundle, swap if different.
//   maybeNoticeUpdate    at-the-end-of-every-command: cheap GET of
//                         the latest-release JSON, rate-limited to
//                         once per 24h via a stamp file, prints a
//                         one-line banner if drift.
//
// Both paths silently absorb network failures so an offline `fairfox
// peers` doesn't feel slow or flaky.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fairfoxPath } from '#src/paths.ts';

declare const __FAIRFOX_CLI_VERSION__: string;

const BUNDLE_PATH = fairfoxPath('fairfox.js');
const STAMP_PATH = fairfoxPath('update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

const GITHUB_OWNER = 'AlexJeffcott';
const GITHUB_REPO = 'fairfox';
// The repo publishes two release tracks: `v*` for the CLI and
// `web-v*` for the SPA bundle. GitHub's `/releases/latest` picks
// whichever is newest *across both*, so we can't use it for the
// CLI — a web release would mask the CLI line. We walk
// `/releases` instead and pick the newest tag starting with `v`
// but not `web-v`.
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const CLI_BUNDLE_URL = (tag: string): string =>
  `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/fairfox.js`;

interface Stamp {
  checkedAt: string;
  lastSeenTag: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

export function localVersion(): string {
  if (typeof __FAIRFOX_CLI_VERSION__ === 'string') {
    return __FAIRFOX_CLI_VERSION__;
  }
  return 'dev';
}

function readStamp(): Stamp | undefined {
  if (!existsSync(STAMP_PATH)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(STAMP_PATH, 'utf8'));
    if (isRecord(parsed)) {
      const { checkedAt, lastSeenTag } = parsed;
      if (typeof checkedAt === 'string' && typeof lastSeenTag === 'string') {
        return { checkedAt, lastSeenTag };
      }
    }
  } catch {
    // Corrupt stamp — treat as absent.
  }
  return undefined;
}

function writeStamp(stamp: Stamp): void {
  try {
    writeFileSync(STAMP_PATH, JSON.stringify(stamp), 'utf8');
  } catch {
    // Best-effort; we re-check next run on failure.
  }
}

async function fetchWithTimeout(url: string): Promise<Response | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    return res;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function isCliTag(tag: string): boolean {
  return tag.startsWith('v') && !tag.startsWith('web-v');
}

async function fetchLatestTag(): Promise<string | undefined> {
  const res = await fetchWithTimeout(RELEASES_API);
  if (!res?.ok) {
    return undefined;
  }
  try {
    const parsed: unknown = await res.json();
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (isRecord(entry)) {
          const tag = entry.tag_name;
          if (typeof tag === 'string' && isCliTag(tag)) {
            return tag;
          }
        }
      }
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** Fetch the latest release bundle and overwrite the local copy if
 * the tag differs from the one baked into this bundle at build
 * time. */
export async function update(): Promise<number> {
  const local = localVersion();
  const latestTag = await fetchLatestTag();
  if (!latestTag) {
    process.stderr.write(
      'fairfox update: could not reach the GitHub release API. Try again later.\n'
    );
    return 1;
  }
  if (latestTag === local) {
    process.stdout.write(`Already up to date (${local}).\n`);
    writeStamp({ checkedAt: new Date().toISOString(), lastSeenTag: latestTag });
    return 0;
  }
  if (!existsSync(BUNDLE_PATH)) {
    process.stderr.write(
      `fairfox update: no local bundle at ${BUNDLE_PATH} — run the install curl first.\n`
    );
    return 1;
  }
  const res = await fetchWithTimeout(CLI_BUNDLE_URL(latestTag));
  if (!res?.ok) {
    process.stderr.write('fairfox update: could not fetch the new bundle.\n');
    return 1;
  }
  try {
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(BUNDLE_PATH, bytes);
  } catch (err) {
    process.stderr.write(
      `fairfox update: could not write ${BUNDLE_PATH} — ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
  writeStamp({ checkedAt: new Date().toISOString(), lastSeenTag: latestTag });
  process.stdout.write(`Updated fairfox CLI\n  ${local} → ${latestTag}\n`);
  return 0;
}

/** End-of-command drift check. Rate-limited to once per 24h.
 * Prints a one-line banner to stderr if the latest release tag
 * differs from the version baked into this bundle. Never blocks
 * the exit code. */
export async function maybeNoticeUpdate(): Promise<void> {
  try {
    const stamp = readStamp();
    const now = Date.now();
    if (stamp) {
      const lastMs = Date.parse(stamp.checkedAt);
      if (!Number.isNaN(lastMs) && now - lastMs < CHECK_INTERVAL_MS) {
        return;
      }
    }
    const latestTag = await fetchLatestTag();
    if (!latestTag) {
      return;
    }
    writeStamp({ checkedAt: new Date().toISOString(), lastSeenTag: latestTag });
    const local = localVersion();
    if (latestTag === local || local === 'dev') {
      return;
    }
    process.stderr.write(
      `\nA new fairfox CLI (${latestTag}) is available. Run \`fairfox update\` to install it.\n`
    );
  } catch {
    // Notice is best-effort; never break the caller.
  }
}
