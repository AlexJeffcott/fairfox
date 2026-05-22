#!/usr/bin/env bun
// Ban fixed-duration waits written inline.
//
// A fixed sleep — `await new Promise((r) => setTimeout(r, n))`,
// `Bun.sleep(n)`, `page.waitForTimeout(n)` — guesses how long an
// operation takes. Too short and it flakes on a loaded machine; too
// long and every run wastes that time. The guess is never right, only
// un-noticed.
//
// Wait on a real signal instead: `pollUntil` (re-check a condition
// until it holds) or `flushMicrotasks` (let a promise chain settle)
// from `@fairfox/shared/timers`, or a web-first puppeteer assertion
// (`waitForSelector`/`waitForFunction`) or the `waitFor` helper in
// `scripts/e2e-config.ts`. Where the wait genuinely IS the behaviour —
// reconnect backoff, the cadence between polls, holding out a lease
// expiry — use `delay` from `@fairfox/shared/timers`.
//
// `timers.ts` is the one file allowed to call `setTimeout` for a
// delay. This script itself is allowlisted because it must name the
// patterns it forbids.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

interface Violation {
  file: string;
  line: number;
  content: string;
  reason: string;
}

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

// Paths (relative to the repo root) exempt from the scan.
const ALLOWLIST = new Set(['packages/shared/src/timers.ts', 'scripts/check-no-fixed-waits.ts']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'artifacts']);

const PATTERNS: { regex: RegExp; reason: string }[] = [
  {
    regex: /new Promise\b.*\bsetTimeout\b/,
    reason:
      'fixed sleep: new Promise wrapping setTimeout — use pollUntil/flushMicrotasks, or delay',
  },
  {
    regex: /\bsetTimeout\s*\(\s*(?:resolve|res|done|_resolve|r)\s*[,)]/,
    reason: 'fixed sleep: setTimeout resolving a promise — use pollUntil/flushMicrotasks, or delay',
  },
  {
    regex: /\bBun\.sleep\s*\(/,
    reason: 'fixed sleep: Bun.sleep — use pollUntil, or delay',
  },
  {
    regex: /\bwaitForTimeout\s*\(/,
    reason: 'fixed sleep: waitForTimeout — wait on a real condition or assertion instead',
  },
];

const violations: Violation[] = [];

async function scanDirectory(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await scanDirectory(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      await scanFile(fullPath);
    }
  }
}

async function scanFile(filePath: string): Promise<void> {
  const rel = relative(repoRoot, filePath);
  if (ALLOWLIST.has(rel)) {
    return;
  }

  const content = await Bun.file(filePath).text();
  const lines = content.split('\n');
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();

    // Skip comments — a doc comment may legitimately name a banned pattern.
    if (inBlockComment) {
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      continue;
    }

    for (const { regex, reason } of PATTERNS) {
      if (regex.test(line)) {
        violations.push({ file: rel, line: i + 1, content: trimmed, reason });
        break;
      }
    }
  }
}

await scanDirectory(join(repoRoot, 'packages'));
await scanDirectory(join(repoRoot, 'scripts'));
await scanDirectory(join(repoRoot, 'tests'));

if (violations.length === 0) {
  console.log('[no-fixed-waits] ok');
  process.exit(0);
}

console.error(`[no-fixed-waits] ${violations.length} violation(s) found:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.reason}]`);
  console.error(`    ${v.content.slice(0, 120)}\n`);
}
console.error('[no-fixed-waits] Use delay/pollUntil/flushMicrotasks from @fairfox/shared/timers.');
process.exit(1);
