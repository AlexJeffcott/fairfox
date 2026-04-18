#!/usr/bin/env bun
// Fairfox's wrapper around @fairfox/polly/quality's checkSharedComponents.
//
// The rule is defined in polly so every consumer of @fairfox/polly/ui
// can enforce it from one place. This script only wires in fairfox's
// exempt-packages list (packages that predate the ban or run on a
// different stack) and routes the print output through the script's
// own stdout / stderr.
//
// Exemptions:
//   - packages/struggle, packages/todo — legacy, exempted per ADR 0006.
//   - Test directories are already skipped by the check's default
//     skipDirs set.

import { resolve } from 'node:path';
import { checkSharedComponents } from '@fairfox/polly/quality';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..');

const result = await checkSharedComponents({
  root: repoRoot,
  exemptPackages: new Set(['struggle', 'todo']),
});

if (result.violations.length === 0) {
  console.log('[shared-components] ok');
  process.exit(0);
}

result.print((msg) => console.error(msg));
console.error('[shared-components] See ADR 0005 and @fairfox/polly/ui/index.ts.');
process.exit(1);
