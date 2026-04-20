#!/usr/bin/env bun
// Ban `require(...)` calls in TypeScript source.
//
// Inline `require` is a CommonJS escape hatch that defeats bundler
// static analysis, hides cross-module dependencies, and lets code
// sneak past `noCommonJs`-style bans when the team isn't looking. A
// previous iteration of `user-identity-node.ts` shipped with
// `const { renameSync } = require('node:fs') as typeof …` wedged
// mid-function; the type cast alone was enough to violate the
// no-as-casting rule, but the underlying sin was the require call.
// This check catches that class of mistake at the source level.
//
// Allowed: `import` / `export` syntax, `require.resolve` (which is
// sometimes necessary for runtime path resolution), string
// references like `require-paired` in filenames.

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
const violations: Violation[] = [];

async function scanDirectory(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await scanDirectory(fullPath);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      entry.name !== 'check-no-require.ts'
    ) {
      await scanFile(fullPath);
    }
  }
}

async function scanFile(filePath: string): Promise<void> {
  const content = await Bun.file(filePath).text();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    // Match a `require(` call that isn't `require.resolve(` and
    // isn't inside a string literal. Cheap heuristic: find the
    // pattern and walk back to make sure we're not mid-string.
    const match = line.match(/\brequire\s*\(/);
    if (!match || match.index === undefined) {
      continue;
    }
    // Allow `require.resolve(`.
    if (line.slice(0, match.index + 7).endsWith('require.resolve(')) {
      continue;
    }
    // Crude string-literal detection: count un-escaped quotes before
    // the match. Odd count → we're mid-string.
    const before = line.slice(0, match.index);
    const singles = (before.match(/(?<!\\)'/g) ?? []).length;
    const doubles = (before.match(/(?<!\\)"/g) ?? []).length;
    const backticks = (before.match(/(?<!\\)`/g) ?? []).length;
    if (singles % 2 === 1 || doubles % 2 === 1 || backticks % 2 === 1) {
      continue;
    }
    violations.push({ file: relative(repoRoot, filePath), line: i + 1, content: trimmed });
  }
}

await scanDirectory(repoRoot);

if (violations.length > 0) {
  console.error('[no-require] FAIL\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.content}`);
  }
  console.error(`\n${violations.length} require() call(s) found. Use ES import syntax instead.`);
  process.exit(1);
}

console.log('[no-require] ok');
