#!/usr/bin/env bun
// Ban inline event-handler props in sub-app source.
//
// The platform rule (ADR 0002) is that user actions go through
// data-action attributes and the global event delegator. Inline
// handlers like onClick, onSubmit, onKeyDown etc are forbidden on
// native elements in sub-app source.
//
// Exemptions:
//   - packages/ui/src — the primitives themselves legitimately use
//     onInput, onKeyDown, onBlur etc on native elements internally.
//   - packages/struggle, packages/todo — legacy, exempted per ADR 0006.
//   - Test files — test setup code is allowed to use handlers.
//
// Adapted from Lingua's scripts/check-no-inline-handlers.ts.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'tests']);
const EXEMPT_PACKAGES = new Set(['ui', 'struggle', 'todo']);

const BANNED_HANDLERS = [
  'onClick',
  'onSubmit',
  'onKeyDown',
  'onKeyUp',
  'onKeyPress',
  'onMouseDown',
  'onMouseUp',
  'onDblClick',
  'onChange',
  'onInput',
  'onBlur',
  'onFocus',
];

interface Violation {
  file: string;
  line: number;
  handler: string;
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
      if (dir === join(repoRoot, 'packages') && EXEMPT_PACKAGES.has(entry.name)) {
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    for (const handler of BANNED_HANDLERS) {
      const pattern = new RegExp(`\\b${handler}\\s*[=({]`);
      if (pattern.test(line)) {
        const commentIndex = line.indexOf('//');
        const handlerIndex = line.indexOf(handler);
        if (commentIndex !== -1 && commentIndex < handlerIndex) {
          continue;
        }

        violations.push({
          file: relative(repoRoot, filePath),
          line: i + 1,
          handler,
          content: trimmed,
        });
      }
    }
  }
}

await scanDirectory(join(repoRoot, 'packages'));

if (violations.length === 0) {
  console.log('[no-inline-handlers] ok');
  process.exit(0);
} else {
  console.error(`[no-inline-handlers] ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.handler}`);
    console.error(`    ${v.content}\n`);
  }
  console.error(
    '[no-inline-handlers] Use data-action attributes and the global event delegator instead.'
  );
  console.error('[no-inline-handlers] See ADR 0002 and packages/ui/src/event-delegation.ts.');
  process.exit(1);
}
