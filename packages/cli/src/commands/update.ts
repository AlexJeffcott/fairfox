// `fairfox update` + the post-command update-check banner.
//
// The CLI bundle is a single pinned-at-install file at
// `~/.fairfox/fairfox.js`; unlike the PWA, nothing about running a
// command reaches back to the server to pick up a newer version.
// These two paths bridge that gap without making every invocation pay
// a round-trip:
//
//   - `fairfox update` (explicit): fetch /cli/fairfox.js, hash it,
//     overwrite the local file if different. Also refreshes the
//     stamp file so the banner stays quiet afterwards.
//   - `maybeNoticeUpdate()` (opportunistic): called after every
//     command. Rate-limited to once per 24h via a stamp file. Hits
//     `/cli/version` for just the SHA, compares, prints a single
//     banner line if drift. Misses (offline, 404, etc.) fail silent
//     so the user's command doesn't feel slow or flaky.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BUNDLE_PATH = join(homedir(), '.fairfox', 'fairfox.js');
const STAMP_PATH = join(homedir(), '.fairfox', 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

interface Stamp {
  checkedAt: string;
  lastSeenSha: string;
}

function defaultBase(): string {
  return process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function readStamp(): Stamp | undefined {
  if (!existsSync(STAMP_PATH)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(STAMP_PATH, 'utf8'));
    if (isRecord(parsed)) {
      const { checkedAt, lastSeenSha } = parsed;
      if (typeof checkedAt === 'string' && typeof lastSeenSha === 'string') {
        return { checkedAt, lastSeenSha };
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
    // Stamp persistence is best-effort; worst case we re-check next
    // run.
  }
}

async function hashFile(path: string): Promise<string | undefined> {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const bytes = new Uint8Array(readFileSync(path));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(url: string): Promise<Response | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteSha(): Promise<string | undefined> {
  const res = await fetchWithTimeout(`${defaultBase().replace(/\/$/, '')}/cli/version`);
  if (!res?.ok) {
    return undefined;
  }
  try {
    const parsed: unknown = await res.json();
    if (isRecord(parsed)) {
      const sha = parsed.sha256;
      if (typeof sha === 'string' && sha.length > 0) {
        return sha;
      }
    }
  } catch {
    // fall through to undefined
  }
  return undefined;
}

/** Fetch the latest CLI bundle and overwrite the local copy if the
 * SHA differs. Idempotent — running against an already-current
 * install is a no-op and prints so. */
export async function update(): Promise<number> {
  const localSha = await hashFile(BUNDLE_PATH);
  if (!localSha) {
    process.stderr.write(
      `fairfox update: no local bundle at ${BUNDLE_PATH} — run the install curl first.\n`
    );
    return 1;
  }
  const base = defaultBase().replace(/\/$/, '');
  const remoteSha = await fetchRemoteSha();
  if (!remoteSha) {
    process.stderr.write('fairfox update: could not reach the fairfox server. Try again later.\n');
    return 1;
  }
  if (remoteSha === localSha) {
    process.stdout.write(`Already up to date (${localSha.slice(0, 12)}).\n`);
    writeStamp({ checkedAt: new Date().toISOString(), lastSeenSha: remoteSha });
    return 0;
  }
  const res = await fetchWithTimeout(`${base}/cli/fairfox.js`);
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
  writeStamp({ checkedAt: new Date().toISOString(), lastSeenSha: remoteSha });
  process.stdout.write(
    `Updated fairfox CLI\n  ${localSha.slice(0, 12)} → ${remoteSha.slice(0, 12)}\n`
  );
  return 0;
}

/** End-of-command drift check. Returns quickly on offline/unreachable
 * paths. Rate-limited to once per 24h against a stamp file. Prints a
 * single line to stderr if the remote bundle SHA differs from the
 * local one. Never blocks the exit code. */
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
    const remoteSha = await fetchRemoteSha();
    if (!remoteSha) {
      return;
    }
    const localSha = await hashFile(BUNDLE_PATH);
    writeStamp({ checkedAt: new Date().toISOString(), lastSeenSha: remoteSha });
    if (!localSha || localSha === remoteSha) {
      return;
    }
    process.stderr.write(
      '\nA new fairfox CLI bundle is available. Run `fairfox update` to install it.\n'
    );
  } catch {
    // Notice is best-effort; never break the caller.
  }
}
