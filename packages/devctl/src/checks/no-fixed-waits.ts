// Check "no-fixed-waits": no fixed-duration wait in any TypeScript file of the
// tree. The defect it names: a wait that guesses how long an operation takes.
// Too short and it flakes on a loaded machine; too long and every run wastes
// the time. Wait on a real signal instead: a promise the operation resolves,
// a process's exit, a condition polled until it holds.
//
// Carried over from eal's scripts/check-no-fixed-waits.ts, with its four
// patterns. eal allowed one timers file; this tree has none. Two files are
// allowed because they name the patterns it forbids: this script, and
// checks.ts, whose red change for this check writes one.
import { join } from 'node:path';
import { repoRoot } from '../repo.ts';
import { typeScriptFiles } from './sources.ts';

type Violation = { file: string; line: number; content: string; reason: string };

const ALLOWLIST = new Set(['packages/devctl/src/checks/no-fixed-waits.ts', 'packages/devctl/src/checks.ts']);

const PATTERNS: readonly { regex: RegExp; reason: string }[] = [
  {
    regex: /new Promise\b.*\bsetTimeout\b/,
    reason: 'fixed sleep: new Promise wrapping setTimeout',
  },
  {
    regex: /\bsetTimeout\s*\(\s*(?:resolve|res|done|_resolve|r)\s*[,)]/,
    reason: 'fixed sleep: setTimeout resolving a promise',
  },
  {
    regex: /\bBun\.sleep\s*\(/,
    reason: 'fixed sleep: Bun.sleep',
  },
  {
    regex: /\bwaitForTimeout\s*\(/,
    reason: 'fixed sleep: waitForTimeout',
  },
];

function scan(file: string, content: string): Violation[] {
  const found: Violation[] = [];
  const lines = content.split('\n');
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const trimmed = line.trim();

    // Skip comments: a doc comment may name a banned pattern.
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    for (const { regex, reason } of PATTERNS) {
      if (regex.test(line)) {
        found.push({ file, line: i + 1, content: trimmed, reason });
        break;
      }
    }
  }
  return found;
}

const root = await repoRoot();
const files = (await typeScriptFiles(root)).filter((file) => !ALLOWLIST.has(file));
const violations: Violation[] = [];
for (const file of files) {
  violations.push(...scan(file, await Bun.file(join(root, file)).text()));
}

if (violations.length > 0) {
  console.log(`Found ${violations.length} fixed-wait violation(s):`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  [${v.reason}]`);
    console.log(`    ${v.content.slice(0, 120)}`);
  }
  process.exit(1);
}
console.log(`No fixed wait in ${files.length} TypeScript files.`);
