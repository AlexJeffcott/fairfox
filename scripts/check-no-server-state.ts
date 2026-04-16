#!/usr/bin/env bun
// Enforce that sub-app server code contains no state-holding routes.
//
// Under the meshState architecture the server is a stateless signaling
// relay. Sub-app server directories should contain only: the signaling
// plugin mount, static file serving, health endpoints, and whitelisted
// LLM proxy routes. Any database imports or Elysia data routes
// (.get/.post/.put/.delete with non-whitelisted paths) are violations.
//
// Legacy packages and the web host are excluded per ADR 0006.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const EXCLUDED_PACKAGES = new Set(['struggle', 'todo', 'web', 'shared', 'ui', '_template']);
const DB_IMPORTS = ['better-sqlite3', 'bun:sqlite', 'openDb', 'drizzle', 'prisma', 'knex'];
const WHITELISTED_ROUTES = ['/health', '/polly/signaling', '/api/llm'];

interface Violation {
  file: string;
  line: number;
  reason: string;
}

const violations: Violation[] = [];

async function scanServerDir(dir: string): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      await scanServerDir(fullPath);
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
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    for (const dbImport of DB_IMPORTS) {
      if (line.includes(dbImport)) {
        violations.push({ file: rel, line: i + 1, reason: `Database import: ${dbImport}` });
      }
    }

    const routeMatch = line.match(/\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (routeMatch) {
      const path = routeMatch[2];
      if (path && !WHITELISTED_ROUTES.some((w) => path.startsWith(w))) {
        violations.push({
          file: rel,
          line: i + 1,
          reason: `Data route: ${routeMatch[1]?.toUpperCase()} ${path}`,
        });
      }
    }
  }
}

async function scanPackages(): Promise<void> {
  const packagesDir = join(repoRoot, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED_PACKAGES.has(entry.name)) {
      continue;
    }
    const serverDir = join(packagesDir, entry.name, 'src', 'server');
    await scanServerDir(serverDir);
  }
}

await scanPackages();

if (violations.length === 0) {
  console.log('[no-server-state] ok');
  process.exit(0);
} else {
  console.error(`[no-server-state] ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.reason}\n`);
  }
  console.error(
    '[no-server-state] Server code should contain only signaling, static files, and health.'
  );
  process.exit(1);
}
