#!/usr/bin/env bun
// Fairfox's wrapper around `@fairfox/polly/quality`'s secret-scanning
// helpers. Runs two checks in sequence:
//
//   1. gitleaks detect against the working tree, using
//      `.gitleaks.toml` as the rule config.
//   2. verify every allowlisted path in that TOML is actually
//      covered by `.gitignore` — so an allowlist entry can't
//      silently turn into a hiding place for a committed secret.
//
// Wired into `bun check`. If gitleaks isn't installed, prints a
// clear install hint and exits non-zero.

import { resolve } from 'node:path';
import { checkGitignoreCoversAllowlist, checkSecrets } from '@fairfox/polly/quality';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..');

const secrets = await checkSecrets({ root: repoRoot, configPath: '.gitleaks.toml' });
if (!secrets.binaryFound) {
  secrets.print((msg) => console.error(msg));
  process.exit(1);
}
if (secrets.exitCode !== 0) {
  secrets.print((msg) => console.error(msg));
  console.error('[secrets] gitleaks found potential secrets (see above).');
  process.exit(secrets.exitCode ?? 1);
}

const gi = await checkGitignoreCoversAllowlist({ root: repoRoot });
if (gi.missing.length > 0) {
  gi.print((msg) => console.error(msg));
  process.exit(1);
}

console.log('[secrets] gitleaks clean');
console.log('[secrets] .gitignore covers every .gitleaks.toml allowlist entry');
