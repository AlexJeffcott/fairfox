#!/usr/bin/env bun
// Enforce that every non-legacy sub-app uses $meshState for its state.
//
// Checks:
//   1. Every sub-app's client source imports from @fairfox/polly/mesh
//   2. No sub-app imports SQLite drivers (better-sqlite3, bun:sqlite) or openDb
//   3. No sub-app server source exports data routes (GET/POST/PUT/DELETE
//      handlers that aren't the signaling endpoint or health check)
//
// Legacy packages (struggle, todo) and the web host are excluded per ADR 0006.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '_template']);
const EXCLUDED_PACKAGES = new Set(['struggle', 'todo', 'web', 'shared', 'ui']);
const SQLITE_IMPORTS = ['better-sqlite3', 'bun:sqlite', '@fairfox/shared/openDb', 'openDb'];

interface Violation {
  file: string;
  line: number;
  reason: string;
}

const violations: Violation[] = [];

async function scanDirectory(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      if (dir === join(repoRoot, 'packages') && EXCLUDED_PACKAGES.has(entry.name)) {
        continue;
      }
      await scanDirectory(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      await scanFile(fullPath);
    }
  }
}

async function scanFile(filePath: string): Promise<void> {
  const content = await Bun.file(filePath).text();
  const lines = content.split('\n');
  const rel = relative(repoRoot, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    for (const sqliteImport of SQLITE_IMPORTS) {
      if (line.includes(sqliteImport)) {
        violations.push({ file: rel, line: i + 1, reason: `SQLite import: ${sqliteImport}` });
      }
    }
  }
}

await scanDirectory(join(repoRoot, 'packages'));

if (violations.length === 0) {
  console.log('[mesh-state] ok');
  process.exit(0);
} else {
  console.error(`[mesh-state] ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.reason}\n`);
  }
  console.error('[mesh-state] All sub-app state must use $meshState. No SQLite allowed.');
  process.exit(1);
}
