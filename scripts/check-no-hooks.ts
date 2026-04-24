#!/usr/bin/env bun
// Ban Preact and signals hooks in sub-app source.
//
// Components are logic-free consumers of signals. State lives in
// module-scoped signals (preferably $state / $sharedState from
// `@fairfox/polly`). Lifecycle work and DOM-level side effects run
// from one-shot `install*()` functions wired into boot.tsx, driven
// by `effect()` from `@preact/signals` at module scope.
//
// The rule applies to the Preact component hooks (useState, useEffect,
// useRef, useMemo, useCallback, useContext, useReducer, useLayoutEffect)
// and to the signals hooks that run inside component lifecycle
// (useSignal, useSignals, useSignalEffect, useComputed). The plain
// `computed()` and `effect()` functions from @preact/signals are fine
// at module scope — they're not hooks.
//
// Exemptions:
//   - packages/ui and packages/extension — third-party or
//     externally-driven code may need hooks. Add to EXEMPT_PACKAGES
//     to carve out further.
//   - Test files.

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'tests']);
const EXEMPT_PACKAGES = new Set(['ui', 'extension']);

const BANNED_HOOKS = [
  'useState',
  'useEffect',
  'useLayoutEffect',
  'useRef',
  'useMemo',
  'useCallback',
  'useContext',
  'useReducer',
  'useSignal',
  'useSignals',
  'useSignalEffect',
  'useComputed',
];

interface Violation {
  file: string;
  line: number;
  hook: string;
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

    for (const hook of BANNED_HOOKS) {
      // Require a call site: `<hook>(` or `<hook><` (generic call).
      // This avoids matching the hook name inside words (e.g. a
      // variable called `useStatesMap`) or in import-specifier
      // noise.
      const pattern = new RegExp(`\\b${hook}\\s*[<(]`);
      if (pattern.test(line)) {
        const commentIndex = line.indexOf('//');
        const hookIndex = line.indexOf(hook);
        if (commentIndex !== -1 && commentIndex < hookIndex) {
          continue;
        }
        // Skip import lines — the import itself is harmless; only
        // the call is a violation. A file that imports but never
        // calls will fail a linter for unused imports anyway.
        if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) {
          continue;
        }

        violations.push({
          file: relative(repoRoot, filePath),
          line: i + 1,
          hook,
          content: trimmed,
        });
      }
    }
  }
}

await scanDirectory(join(repoRoot, 'packages'));

if (violations.length === 0) {
  console.log('[no-hooks] ok');
  process.exit(0);
} else {
  console.error(`[no-hooks] ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.hook}`);
    console.error(`    ${v.content}\n`);
  }
  console.error('[no-hooks] Components are hook-free. Put state in module-scoped signals');
  console.error('[no-hooks] (prefer $state / $sharedState from @fairfox/polly) and run side');
  console.error('[no-hooks] effects from install*() functions wired into boot.tsx.');
  process.exit(1);
}
