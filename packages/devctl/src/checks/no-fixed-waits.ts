// Check "no-fixed-waits": no fixed-duration wait in any TypeScript file of the
// tree. The defect it names: a wait that guesses how long an operation takes.
// Too short and it flakes on a loaded machine; too long and every run wastes
// the time. Wait on a real signal instead: a promise the operation resolves,
// a process's exit, a condition polled until it holds.
//
// eal's script matched four patterns line by line. This one parses each file
// with the TypeScript compiler API, so no file needs an exemption: see
// findFixedWaits in waits.ts.
import { join } from 'node:path';
import { repoRoot } from '../repo.ts';
import { typeScriptFiles } from './sources.ts';
import type { Finding } from './syntax.ts';
import { findFixedWaits } from './waits.ts';

const root = await repoRoot();
const files = await typeScriptFiles(root);
const found: Finding[] = [];
for (const file of files) {
  found.push(...findFixedWaits(file, await Bun.file(join(root, file)).text()));
}

if (found.length > 0) {
  console.log(`Found ${found.length} fixed wait(s):`);
  for (const f of found) {
    console.log(`  ${f.file}:${f.line}  [${f.reason}]  ${f.text.slice(0, 100)}`);
  }
  process.exit(1);
}
console.log(`No fixed wait in ${files.length} TypeScript files.`);
