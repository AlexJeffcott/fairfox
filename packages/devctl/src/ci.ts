import { writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Check, CHECKS, type RedChange } from './checks.ts';
import type { Command } from './command.ts';
import { type Ran, run, seconds } from './proc.ts';
import { recordDecision } from './record.ts';
import { head, isClean } from './repo.ts';

/**
 * The record of a green run (M6), one file per commit. It is gitignored.
 * `devctl deploy` (step 0b) reads it, and refuses a commit without one.
 */
export type CiRecord = {
  commit: string;
  finishedAt: string;
  /** The name of every check that ran green: every check registered at that commit. */
  green: readonly string[];
};

export function recordPath(root: string, commit: string): string {
  return join(root, '.devctl', 'ci', `${commit}.json`);
}

const duplicate = CHECKS.find((c, i) => CHECKS.findIndex((d) => d.name === c.name) !== i);
if (duplicate !== undefined) {
  throw new Error(`Two checks are named ${duplicate.name} in packages/devctl/src/checks.ts`);
}

const width = Math.max(...CHECKS.map((c) => c.name.length));

function line(state: string, check: Check, detail: string): string {
  return `${state.padEnd(5)}  ${check.name.padEnd(width)}  ${detail}`;
}

/** The last lines of a check's output, enough to see why it went red. */
function tail(output: string): string {
  return output.trimEnd().split('\n').slice(-40).join('\n');
}

async function green(root: string, checks: readonly Check[], full: boolean): Promise<number> {
  const commit = await head(root);
  const cleanBefore = await isClean(root);
  const red: string[] = [];
  for (const check of checks) {
    const result = await run(check.run, root);
    console.log(line(result.code === 0 ? 'green' : 'RED', check, seconds(result.ms)));
    if (result.code !== 0) {
      red.push(check.name);
      console.log(tail(result.output));
    }
  }

  const decision = recordDecision({
    full,
    red: red.length,
    cleanBefore,
    cleanAfter: await isClean(root),
    headBefore: commit,
    headAfter: await head(root),
  });
  if (decision === 'partial') {
    console.log('\n--only: a partial run writes no record.');
  } else if (decision === 'red') {
    await rm(recordPath(root, commit), { force: true });
    console.log(`\nRed: ${red.join(', ')}. No record for ${commit}.`);
  } else if (decision === 'not-one-commit') {
    console.log('\nEvery check is green, but the working tree was not clean, or HEAD moved.');
    console.log(`The run is not a run of ${commit}: no record written. Commit, then run devctl ci again.`);
  } else {
    const record: CiRecord = { commit, finishedAt: new Date().toISOString(), green: checks.map((c) => c.name) };
    const path = recordPath(root, commit);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`\nEvery check is green on ${commit}. Record: ${path}`);
  }
  return red.length === 0 ? 0 : 1;
}

function occurrences(text: string, find: string): number {
  return text.split(find).length - 1;
}

/** Make one change, run its check, put the file back. Returns a failure, or null when the check went red as recorded. */
async function seeRed(root: string, check: Check, change: RedChange): Promise<string | null> {
  const path = join(root, change.file);
  if (!(await Bun.file(path).exists())) {
    return `${change.file} does not exist. Update packages/devctl/src/checks.ts.`;
  }
  const original = await Bun.file(path).text();
  const count = occurrences(original, change.find);
  if (count !== 1) {
    return `its find text occurs ${count} times in ${change.file}; it must occur once. Update packages/devctl/src/checks.ts.`;
  }
  // Ctrl-C while the change is in place must not leave it there.
  const restore = () => {
    writeFileSync(path, original);
    process.exit(130);
  };
  process.once('SIGINT', restore);
  await Bun.write(path, original.replace(change.find, change.replace));
  let result: Ran;
  try {
    result = await run(check.run, root);
  } finally {
    await Bun.write(path, original);
    process.removeListener('SIGINT', restore);
  }
  if (result.code === 0) {
    return 'the check stayed green. It proves nothing.';
  }
  if (!result.output.includes(change.output)) {
    return `the check went red, but its output does not contain ${JSON.stringify(change.output)}: it went red for another reason.\n${tail(result.output)}`;
  }
  return null;
}

async function red(root: string, checks: readonly Check[]): Promise<number> {
  let failures = 0;
  for (const check of checks) {
    for (const change of check.red) {
      const failure = await seeRed(root, check, change);
      if (failure === null) {
        console.log(line('red', check, change.breaks));
      } else {
        failures++;
        console.log(line('FAIL', check, `${change.breaks}: ${failure}`));
      }
    }
  }
  console.log('\nEvery file is back. The same checks, green again:');
  for (const check of checks) {
    const result = await run(check.run, root);
    console.log(line(result.code === 0 ? 'green' : 'RED', check, seconds(result.ms)));
    if (result.code !== 0) {
      failures++;
      console.log(tail(result.output));
    }
  }
  const changes = checks.reduce((n, c) => n + c.red.length, 0);
  console.log(
    failures === 0
      ? `\nEach of ${changes} changes turned its check red, as recorded.`
      : `\n${failures} ${failures === 1 ? 'failure' : 'failures'}. A check that cannot be made red is deleted (M3).`,
  );
  return failures === 0 ? 0 : 1;
}

export const ci: Command = {
  name: 'ci',
  summary: 'Run every registered check on the commit that is checked out',
  args: '',
  help: `
CI (M6). Run every registered check, in order, on the commit that is
checked out. When all are green and the working tree was clean from start
to end, write the record of the run to .devctl/ci/<commit>.json: the commit
and the checks that ran green. The file is gitignored; devctl deploy
reads it. A red run removes that commit's record.

With --red, see each check red instead (M3): make each change recorded
beside the check, run the check, expect red with the recorded output, and
put the file back. Then run the same checks green. Writes no record.

To register a check, add one entry to CHECKS in
packages/devctl/src/checks.ts. That file also sets down the form of the
change that makes a check red.

Checks:
${CHECKS.map((c) => `  ${c.name.padEnd(width)}  ${c.catches}`).join('\n')}
`,
  flags: [
    { name: 'only', takes: 'check', help: 'Run only this check; may be given more than once. Writes no record' },
    { name: 'red', help: 'See each check red with its recorded change, then green again' },
    { name: 'list', help: 'List the registered checks and what each catches' },
  ],
  run: async ({ root, positionals, flag, values }) => {
    if (positionals.length > 0) {
      console.error(`devctl ci takes no arguments. To run one check: devctl ci --only ${positionals[0]}`);
      return 1;
    }
    if (flag('list')) {
      for (const c of CHECKS) {
        console.log(`${c.name.padEnd(width)}  ${c.catches}`);
      }
      return 0;
    }
    const only = values('only');
    const unknown = only.filter((name) => !CHECKS.some((c) => c.name === name));
    if (unknown.length > 0) {
      console.error(`Unknown check: ${unknown.join(', ')}. Checks: ${CHECKS.map((c) => c.name).join(', ')}`);
      return 1;
    }
    const chosen = only.length === 0 ? CHECKS : CHECKS.filter((c) => only.includes(c.name));
    return flag('red') ? red(root, chosen) : green(root, chosen, only.length === 0);
  },
};
