#!/usr/bin/env bun
// Ban raw native interactive HTML elements in sub-app source.
//
// The platform rule (ADR 0005) is that sub-apps use the shared
// primitives from @fairfox/polly/ui (Button, ActionInput, Layout, etc.)
// rather than writing raw <button>, <input>, <select>, <textarea>, or
// <form> elements. The primitives enforce data-action delegation,
// typed CSS modules, accessibility attributes, and the layout ban.
//
// Exemptions:
//   - packages/struggle, packages/todo — legacy, exempted per ADR 0006.
//   - Test files — test setup code may create native elements.
//
// Adapted from Lingua's scripts/check-shared-components.ts.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'tests']);
const EXEMPT_PACKAGES = new Set(['struggle', 'todo']);

const ELEMENT_RULES = [
  { pattern: /<button[\s>]/, element: '<button>', replacement: '<Button>' },
  { pattern: /<input[\s>/]/, element: '<input>', replacement: '<ActionInput> or <TextInput>' },
  {
    pattern: /<textarea[\s>]/,
    element: '<textarea>',
    replacement: '<ActionInput variant="multi">',
  },
  { pattern: /<select[\s>]/, element: '<select>', replacement: '<Select>' },
  { pattern: /<form[\s>]/, element: '<form>', replacement: '<ActionForm>' },
];

interface Violation {
  file: string;
  line: number;
  element: string;
  replacement: string;
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
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
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

    for (const rule of ELEMENT_RULES) {
      if (rule.pattern.test(line)) {
        const commentIndex = line.indexOf('//');
        const elementIndex = line.search(rule.pattern);
        if (commentIndex !== -1 && commentIndex < elementIndex) {
          continue;
        }

        if (rule.element === '<input>' && /type=["']hidden["']/.test(line)) {
          continue;
        }

        violations.push({
          file: relative(repoRoot, filePath),
          line: i + 1,
          element: rule.element,
          replacement: rule.replacement,
          content: trimmed,
        });
      }
    }
  }
}

await scanDirectory(join(repoRoot, 'packages'));

if (violations.length === 0) {
  console.log('[shared-components] ok');
  process.exit(0);
} else {
  console.error(`[shared-components] ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.element} → use ${v.replacement}`);
    console.error(`    ${v.content}\n`);
  }
  console.error(
    '[shared-components] Use @fairfox/polly/ui primitives instead of native HTML elements.'
  );
  console.error('[shared-components] See ADR 0005 and @fairfox/polly/ui/index.ts.');
  process.exit(1);
}
