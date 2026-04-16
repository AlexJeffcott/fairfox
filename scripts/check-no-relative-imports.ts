#!/usr/bin/env bun
// Ban relative imports in intra-package source files.
//
// Each fairfox package declares "imports": { "#src/*": "./src/*" } in
// its package.json. Source files should import via #src/... subpath
// imports rather than relative paths (../../utils/foo.ts). This
// prevents the monorepo path-collision problem described in Lingua's
// SKILL.md: tsconfig paths collide across packages in monorepo tsc
// because all packages resolve to source; package.json imports
// resolves per-package (nearest package.json), eliminating this.
//
// Exemptions:
//   - index.ts re-export files — these use relative paths by
//     convention (e.g., export { Button } from './Button.tsx').
//   - CSS module imports — TypeScript can't resolve CSS through #src
//     imports, so "./Component.module.css" is allowed.
//   - Test files — tests import from ../src/ which is across the
//     src/tests boundary, so relative is the natural shape.
//   - Legacy packages (struggle, todo, web, shared) — pre-existing
//     code brought into conformance in their own tasks.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'tests', 'scripts']);
const EXCLUDED_PACKAGES = new Set(['struggle', 'todo', 'web', 'shared']);

const RELATIVE_IMPORT = /(?:from\s+['"]|import\s+['"])(\.\.\/.+?|\.\/[^.].+?)['"]/;

interface Violation {
  file: string;
  line: number;
  content: string;
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
      if (entry.name === 'index.ts') {
        continue;
      }
      await scanFile(fullPath);
    }
  }
}

async function scanFile(filePath: string): Promise<void> {
  const content = await Bun.file(filePath).text();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    const match = line.match(RELATIVE_IMPORT);
    if (match) {
      const importPath = match[1];
      if (!importPath) {
        continue;
      }
      if (importPath.endsWith('.module.css')) {
        continue;
      }
      violations.push({
        file: relative(repoRoot, filePath),
        line: i + 1,
        content: trimmed,
      });
    }
  }
}

await scanDirectory(join(repoRoot, 'packages'));

if (violations.length === 0) {
  console.log('[no-relative-imports] ok');
  process.exit(0);
} else {
  console.error(`[no-relative-imports] ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.content}\n`);
  }
  console.error('[no-relative-imports] Use #src/... subpath imports instead of relative paths.');
  console.error('[no-relative-imports] See package.json "imports" field and Lingua SKILL.md.');
  process.exit(1);
}
