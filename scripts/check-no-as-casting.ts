#!/usr/bin/env bun
// Ban type assertions (as Type) throughout the codebase.
//
// Allowed patterns:
//   - "as const" — literal type narrowing, safe
//   - "as unknown as" — explicit escape hatch for truly impossible cases
//   - import/export renames: import { X as Y }, export { X as Y }
//   - SQL aliases inside string literals
//   - Prose inside JSX text content
//
// Everything else is a violation. Use type guards, validation, or fix
// the types at the source instead. See ADR 0001 for the rationale.
//
// Note: @fairfox/polly ships a quality CLI (polly check) that does the
// same scan, but without per-package exclusions. Once the legacy
// packages (struggle, todo, web, shared) are retired or brought into
// conformance, this script can be replaced with the polly CLI.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

interface Violation {
  file: string;
  line: number;
  content: string;
}

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
// Packages excluded from the as-casting check. Legacy packages (struggle, todo)
// are exempted per ADR 0006. web and shared predate the check and will be brought
// into conformance in their own tasks.
const EXCLUDED_PACKAGES = new Set(['struggle', 'todo', 'web', 'shared']);
// Pre-existing scripts that predate the as-casting ban. Fix in their own tasks.
const EXCLUDED_FILES = new Set(['relay.ts', 'verify-migration.ts']);

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
      if (!EXCLUDED_FILES.has(entry.name)) {
        await scanFile(fullPath);
      }
    }
  }
}

async function scanFile(filePath: string): Promise<void> {
  const content = await Bun.file(filePath).text();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes(' as ')) {
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    const commentIndex = line.indexOf('//');
    const asIndex = line.indexOf(' as ');
    if (commentIndex !== -1 && commentIndex < asIndex) {
      continue;
    }

    if (line.includes(' as const')) {
      continue;
    }
    if (line.includes(' as unknown as ')) {
      continue;
    }

    if (line.match(/\bas\s*[=:,]/)) {
      continue;
    }
    if (line.match(/\)\s+as\s+\w+/)) {
      continue;
    }

    if (
      line.match(/\b(import|export)\s+.*\s+as\s+\w+/) ||
      line.match(/\b(import|export)\s+\*\s+as\s+\w+/) ||
      line.match(/\b(import|export)\s+type\s+.*\s+as\s+\w+/) ||
      line.match(/^\s*\w+\s+as\s+\w+,\s*$/)
    ) {
      continue;
    }

    const beforeAs = line.substring(0, asIndex);
    const singleQuotes = (beforeAs.match(/'/g) ?? []).length;
    const doubleQuotes = (beforeAs.match(/"/g) ?? []).length;
    const backticks = (beforeAs.match(/`/g) ?? []).length;
    if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1 || backticks % 2 === 1) {
      continue;
    }

    const textBeforeAs = line.substring(0, asIndex);
    const lastOpenBracket = textBeforeAs.lastIndexOf('>');
    const nextCloseBracket = line.indexOf('<', asIndex);
    if (lastOpenBracket !== -1 && nextCloseBracket !== -1) {
      const between = line.substring(lastOpenBracket + 1, nextCloseBracket);
      if (
        !between.includes('{') &&
        !between.includes('}') &&
        !between.includes('"') &&
        !between.includes("'") &&
        !between.includes('`')
      ) {
        continue;
      }
    }

    if (
      !textBeforeAs.includes('=') &&
      !textBeforeAs.includes('{') &&
      !textBeforeAs.includes('}') &&
      !textBeforeAs.includes(':') &&
      !textBeforeAs.includes(';') &&
      !textBeforeAs.includes('(') &&
      !line.includes('const ') &&
      !line.includes('let ') &&
      !line.includes('var ')
    ) {
      continue;
    }

    violations.push({
      file: relative(repoRoot, filePath),
      line: i + 1,
      content: trimmed,
    });
  }
}

await scanDirectory(join(repoRoot, 'packages'));
await scanDirectory(join(repoRoot, 'scripts'));

if (violations.length === 0) {
  console.log('[no-as-casting] ok');
  process.exit(0);
} else {
  console.error(`[no-as-casting] ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.content}\n`);
  }
  console.error('[no-as-casting] Use type guards, validation, or fix the types at the source.');
  console.error('[no-as-casting] Only "as const" and "as unknown as" are allowed.');
  process.exit(1);
}
