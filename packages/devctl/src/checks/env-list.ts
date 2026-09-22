// Check "env-list": every variable the server's code reads is in DEPLOY.md,
// and every variable DEPLOY.md says the code reads is read (C3). The code's
// list: the SETTINGS table of packages/server/src/config.ts, every process.env
// in a TypeScript file under packages/server/, and every $FAIRFOX_* in a shell
// script there (serve.sh hands two settings to Litestream).
import { join } from 'node:path';
import { SETTINGS } from '../../../server/src/config.ts';
import { compareVariables, documentedVariables, processEnvIn, shellVariablesIn } from '../env-list.ts';
import { repoRoot } from '../repo.ts';
import { typeScriptFiles } from './sources.ts';

const root = await repoRoot();
const SERVER = 'packages/server/';
const DOCUMENT = 'DEPLOY.md';
const HEADING = 'Every setting the code reads (C3)';

const read = new Set<string>(Object.values(SETTINGS));
for (const file of (await typeScriptFiles(root)).filter((f) => f.startsWith(SERVER))) {
  for (const name of processEnvIn(await Bun.file(join(root, file)).text())) {
    read.add(name);
  }
}
const scripts = await Array.fromAsync(new Bun.Glob('packages/server/**/*.sh').scan({ cwd: root }));
for (const file of scripts.sort()) {
  for (const name of shellVariablesIn(await Bun.file(join(root, file)).text())) {
    read.add(name);
  }
}

const documented = documentedVariables(await Bun.file(join(root, DOCUMENT)).text(), HEADING);
const { undocumented, unread } = compareVariables([...read], documented);

const problems: string[] = [];
if (undocumented.length > 0) {
  problems.push(`${SERVER} reads ${undocumented.join(', ')}, and ${DOCUMENT} does not list it under "${HEADING}".`);
}
if (unread.length > 0) {
  problems.push(`${DOCUMENT} lists ${unread.join(', ')} under "${HEADING}", and nothing in ${SERVER} reads it.`);
}
if (problems.length > 0) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log(`${DOCUMENT} lists the ${documented.length} variables ${SERVER} reads: ${documented.join(', ')}.`);
