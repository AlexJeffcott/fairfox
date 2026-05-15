#!/usr/bin/env bun
// Forbid `<wrapper>.value = ...` writes against any $meshState-derived
// wrapper. ADR 0009 commits fairfox to a single legal write surface for
// every household-shared document: per-key `handle.change(...)`. The
// value-setter path lowers to polly's `applyTopLevel`, which replaces
// each top-level field as one Automerge op — and that op resolves
// concurrent per-key edits on the same field by actor-id hash, silently
// dropping one side. fairfox#22 captured the live damage when
// peersGcRevoked used this path.
//
// This script enforces the rule across the codebase at lint time so
// the next regression surfaces at the commit that introduces it
// rather than at a customer's mesh that won't converge.
//
// Two-pass design:
//
//   1. Discovery — walk packages/*/src and find every binding declared
//      `const NAME = $meshState<...>(...)`. Also include the four
//      shared-wrapper exports (devicesState, usersState, meshMetaState,
//      documentIndexState) which expose value getters/setters indirectly
//      around the underlying primitive.
//
//   2. Violation — for every .ts/.tsx file in the same walk, flag any
//      `<NAME>.value = ...` (or `<NAME>.value  =  ...`) write where
//      NAME is in the discovered set.
//
// Excludes:
//   - The wrapper-definition files themselves (they retain
//     `set value(next: ...) { ... }` accessors that pass writes through
//     to polly's primitive; the rule applies to call sites, not the
//     wrapper internals — Phase F removes those setters anyway).
//   - *.test.ts / *.test.tsx — tests legitimately reset signal state
//     in isolation; the convergence concern doesn't apply to seeded
//     test fixtures.
//   - scripts/ — operator tooling and the existing migration helpers.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

interface Violation {
  file: string;
  line: number;
  content: string;
}

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

const WRAPPER_DEFINITION_FILES = new Set([
  'packages/shared/src/devices-state.ts',
  'packages/shared/src/users-state.ts',
  'packages/shared/src/mesh-meta-state.ts',
  'packages/shared/src/document-index-state.ts',
]);

// Always-known bindings that aren't bound directly via $meshState in a
// .ts source (they wrap a `primitive()` call). The check needs these
// because they're imported across packages and assigned to via
// `<name>.value = ...` in many call sites that the discovery pass
// wouldn't otherwise know to recognise. Listed explicitly so any
// future wrapper that uses the same indirection pattern is added here
// at the moment of its creation.
const ALWAYS_KNOWN_BINDINGS = new Set([
  'devicesState',
  'usersState',
  'meshMetaState',
  'documentIndexState',
]);

const BINDING_DISCOVERY_RE =
  /(?:export\s+)?const\s+([a-zA-Z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*\$meshState\s*(?:<[^>]+>)?\s*\(/g;

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
}

async function discoverBindings(files: readonly string[]): Promise<Set<string>> {
  const bindings = new Set<string>(ALWAYS_KNOWN_BINDINGS);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const matches = text.matchAll(BINDING_DISCOVERY_RE);
    for (const m of matches) {
      const name = m[1];
      if (typeof name === 'string') {
        bindings.add(name);
      }
    }
  }
  return bindings;
}

async function findViolations(
  files: readonly string[],
  bindings: ReadonlySet<string>
): Promise<Violation[]> {
  const names = [...bindings];
  if (names.length === 0) {
    return [];
  }
  const violationRe = new RegExp(`\\b(?:${names.join('|')})\\.value\\s*=`);
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (WRAPPER_DEFINITION_FILES.has(rel)) {
      continue;
    }
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      // Strip line comments — `// signal.value = ...` is documentation,
      // not a write. Skip lines that are entirely a JSDoc / block-
      // comment body (they start with `*` or `/*` after the indent).
      // The two combined cover the realistic noise floor without
      // needing a full TypeScript parse.
      const trimmed = line.trimStart();
      if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) {
        continue;
      }
      const codeOnly = line.replace(/\/\/.*$/, '');
      if (violationRe.test(codeOnly)) {
        violations.push({ file: rel, line: i + 1, content: line.trim() });
      }
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const sources: string[] = [];
  await walk(join(repoRoot, 'packages'), sources);
  const bindings = await discoverBindings(sources);
  const violations = await findViolations(sources, bindings);
  if (violations.length === 0) {
    console.log('[no-mesh-state-value-assign] ok');
    process.exit(0);
  }
  console.error(`[no-mesh-state-value-assign] ${violations.length} violation(s) found:`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.content}`);
  }
  console.error('');
  console.error('Use handle.change((doc) => doc.field[key] = value) for per-key writes. The');
  console.error('value-setter path races concurrent peer writes on the same top-level field');
  console.error('and silently discards one side by actor-id hash. ADR 0009 non-negotiable #1.');
  process.exit(1);
}

await main();
