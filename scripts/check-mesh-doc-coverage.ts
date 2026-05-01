#!/usr/bin/env bun
// Enforce that every $meshState document key referenced in source has at
// least one e2e test under scripts/ that explicitly declares coverage of
// it via an `// @covers: foo:bar, baz:qux` comment.
//
// Mutation testing round-2 surfaced that subtle key-targeted corruption
// (e.g. `applyTopLevel` skipping the "users" top-level key) is caught
// only when a test happens to write to the affected doc. e2e-mesh-
// roundtrip is blind to mesh:users corruption because it only writes
// chat:main; e2e-user-revocation catches it because it touches
// mesh:users. Greps over CLI verbs and string literals were too noisy
// to be reliable, so the contract is opt-in: each e2e declares what
// it covers, and this check fails if any source key is unclaimed.
//
// Detection:
//   - Source side: every literal `$meshState<...>('foo:bar', ...)` in
//     packages/*/src/.
//   - Test side: every `// @covers: foo:bar` (or `// @covers: foo:bar,
//     baz:qux`) line in scripts/e2e-*.ts.
//
// Keys may be exempted by adding them to EXEMPT_KEYS below with a
// reason — required if a doc legitimately has no e2e (e.g. it's used
// only inside a single-CLI flow where unit tests are sufficient).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');

// Keys that don't need e2e coverage. Add with a one-line reason so
// future readers can re-evaluate.
const EXEMPT_KEYS: ReadonlyMap<string, string> = new Map<string, string>([
  ['template:app', '_template package is a scaffold copy-paste source, not a real sub-app'],
  // The following sub-apps are browser-only — they have no CLI verb, so
  // a CLI e2e cannot exercise their docs directly. Adding coverage means
  // either (a) a puppeteer-driven e2e for that sub-app, or (b) a CLI
  // verb (e.g. `fairfox docs add`) that lets a CLI test write to the
  // doc. Either is bigger scope than the mutation-coverage closure;
  // exempt with a pointer so the gap is visible without blocking work.
  ['docs:main', 'browser-only sub-app — needs CLI verb or puppeteer e2e for coverage'],
  ['family-phone:directory', 'browser-only sub-app — needs CLI verb or puppeteer e2e for coverage'],
  ['library:main', 'browser-only sub-app — needs CLI verb or puppeteer e2e for coverage'],
  ['speakwell:sessions', 'browser-only sub-app — needs CLI verb or puppeteer e2e for coverage'],
  ['struggle:progress', 'browser-only sub-app — needs CLI verb or puppeteer e2e for coverage'],
  ['struggle:story', 'browser-only sub-app — needs CLI verb or puppeteer e2e for coverage'],
  ['todo:captures', 'no CLI verb writes captures today — `todo capture` would be the path'],
]);

// $meshState<...>('foo:bar', ...) and $meshState('foo:bar', ...).
// The type-parameter group is optional, the doc-key literal is in
// group 1.
const MESH_STATE_RE = /\$meshState(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g;

// // @covers: foo:bar, baz:qux
const COVERS_RE = /\/\/\s*@covers:\s*(.+)$/gim;

interface Hit {
  key: string;
  file: string;
  line: number;
}

function walk(dir: string, out: string[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build') {
      continue;
    }
    const full = join(dir, name);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (stat.isFile() && (name.endsWith('.ts') || name.endsWith('.tsx'))) {
      out.push(full);
    }
  }
}

function findKeysInSource(): Hit[] {
  const sources: string[] = [];
  walk(join(repoRoot, 'packages'), sources);
  const hits: Hit[] = [];
  for (const file of sources) {
    if (file.includes('/tests/') || file.endsWith('.test.ts')) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const matches = line.matchAll(MESH_STATE_RE);
      for (const m of matches) {
        const key = m[1];
        if (typeof key === 'string') {
          hits.push({ key, file, line: i + 1 });
        }
      }
    }
  }
  return hits;
}

function findCoverageInTests(): Map<string, string[]> {
  const dir = join(repoRoot, 'scripts');
  const covered = new Map<string, string[]>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return covered;
  }
  for (const name of names) {
    if (!name.startsWith('e2e-') || !name.endsWith('.ts')) {
      continue;
    }
    const text = readFileSync(join(dir, name), 'utf8');
    const matches = text.matchAll(COVERS_RE);
    for (const m of matches) {
      const list = m[1] ?? '';
      for (const raw of list.split(',')) {
        const key = raw.trim();
        if (key.length === 0) {
          continue;
        }
        const existing = covered.get(key) ?? [];
        existing.push(name);
        covered.set(key, existing);
      }
    }
  }
  return covered;
}

const sourceHits = findKeysInSource();
const knownKeys = new Set(sourceHits.map((h) => h.key));
const covered = findCoverageInTests();

const uncovered: string[] = [];
for (const key of knownKeys) {
  if (covered.has(key)) {
    continue;
  }
  if (EXEMPT_KEYS.has(key)) {
    continue;
  }
  uncovered.push(key);
}

if (uncovered.length === 0) {
  process.stdout.write(
    `[mesh-doc-coverage] ok — every one of ${knownKeys.size} $meshState key${knownKeys.size === 1 ? '' : 's'} has an e2e mention\n`
  );
  process.exit(0);
}

process.stderr.write('[mesh-doc-coverage] failed — keys without e2e coverage:\n');
for (const key of uncovered.sort()) {
  const sites = sourceHits
    .filter((h) => h.key === key)
    .slice(0, 3)
    .map((h) => `${h.file.replace(`${repoRoot}/`, '')}:${h.line}`)
    .join(', ');
  process.stderr.write(`  ${key}\n    sites: ${sites}\n`);
}
process.stderr.write(
  '\nFix by adding `// @covers: <key>` to one of the scripts/e2e-*.ts files that ' +
    'materially exercises the key, or by adding a one-line exemption to EXEMPT_KEYS in this script.\n'
);
process.exit(1);
