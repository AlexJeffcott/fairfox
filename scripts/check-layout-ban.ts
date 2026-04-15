// Enforce that flex and grid layout properties only appear inside the
// Layout component's own CSS module. This is the repo-level mechanism
// for ADR 0005's rule that all layout decisions are centralised in
// @fairfox/ui's Layout primitive. Every other component wraps children
// in <Layout> rather than reaching for display: flex or display: grid
// directly.
//
// Run as part of the @fairfox/ui typecheck chain so the rule is
// checked on every commit. The script walks packages/ui/src for CSS
// files, reads each one, and fails if any of them (other than
// Layout.module.css itself) contains a banned layout property.
//
// Legacy packages (packages/struggle, packages/todo) are deliberately
// excluded — they are slated for rebuild under ADR 0006 and carry
// documented relaxations in the meantime. When each is retired, the
// conformance test in a later task can drop them from the skip list.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const BANNED = new RegExp(
  [
    'display\\s*:\\s*(flex|inline-flex|grid|inline-grid)',
    'align-items\\s*:',
    'align-content\\s*:',
    'justify-content\\s*:',
    'justify-items\\s*:',
    'flex-direction\\s*:',
    'flex-wrap\\s*:',
    'flex-flow\\s*:',
    'flex-grow\\s*:',
    'flex-shrink\\s*:',
    'flex-basis\\s*:',
    'flex\\s*:',
    'grid-template\\s*:',
    'grid-template-rows\\s*:',
    'grid-template-columns\\s*:',
    'grid-template-areas\\s*:',
    'grid-area\\s*:',
    'grid-row\\s*:',
    'grid-column\\s*:',
  ].join('|')
);

const scriptDir = new URL('.', import.meta.url).pathname;
const repoRoot = resolve(scriptDir, '..');
const uiSrc = join(repoRoot, 'packages/ui/src');
const layoutCss = 'packages/ui/src/components/Layout/Layout.module.css';

function walkCss(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') {
        continue;
      }
      walkCss(full, files);
    } else if (entry.endsWith('.css')) {
      files.push(full);
    }
  }
  return files;
}

const cssFiles = walkCss(uiSrc);
let errors = 0;

for (const file of cssFiles) {
  const rel = relative(repoRoot, file);
  if (rel === layoutCss) {
    continue;
  }
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('*')) {
      return;
    }
    const match = line.match(BANNED);
    if (match) {
      console.error(`[layout-ban] ${rel}:${index + 1}: ${match[0].trim()}`);
      errors += 1;
    }
  });
}

if (errors > 0) {
  console.error(`[layout-ban] ${errors} violation(s) found.`);
  console.error('[layout-ban] Use the Layout component instead of raw flex or grid.');
  console.error('[layout-ban] See packages/ui/src/components/Layout/ and ADR 0005.');
  process.exit(1);
}

console.log(`[layout-ban] ok — ${cssFiles.length} file(s) checked`);
