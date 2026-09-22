// Check "no-as-casting": no type assertion in any TypeScript file of the tree.
// The defect it names: a value whose type the code asserts and the compiler
// never checks. Narrow with a type guard instead.
//
// eal's script scanned lines, and let most casts through. This one parses
// each file with the TypeScript compiler API: see findCasts in casts.ts.
import { join } from 'node:path';
import { repoRoot } from '../repo.ts';
import { findCasts } from './casts.ts';
import { typeScriptFiles } from './sources.ts';
import type { Finding } from './syntax.ts';

const root = await repoRoot();
const files = await typeScriptFiles(root);
const found: Finding[] = [];
for (const file of files) {
  found.push(...findCasts(file, await Bun.file(join(root, file)).text()));
}

if (found.length > 0) {
  console.log(`Found ${found.length} type assertion(s):`);
  for (const f of found) {
    console.log(`  ${f.file}:${f.line}  ${f.text.split('\n')[0]?.slice(0, 120)}`);
  }
  process.exit(1);
}
console.log(`No type assertion in ${files.length} TypeScript files.`);
