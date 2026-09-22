import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from './command.ts';
import { childEnv, run } from './proc.ts';

/**
 * Stryker mutation testing, as in lingua: one package at a time, each with its
 * own config, stryker/<package>.conf.json, that mutates only that package's
 * src and runs only that package's tests with Stryker's command runner. No
 * patch. A config's break threshold is 100: one mutant that the tests let
 * pass fails the run. The defect it catches: a test that passes when the
 * code is wrong (L6, "test gaps").
 */
const CONFIGS = 'stryker';
const SUFFIX = '.conf.json';

/** The packages that have a Stryker config. */
async function configured(root: string): Promise<string[]> {
  const files = await readdir(join(root, CONFIGS));
  return files
    .filter((f) => f.endsWith(SUFFIX))
    .map((f) => f.slice(0, -SUFFIX.length))
    .sort();
}

/** The packages whose files changed between `ref` and HEAD, on this branch. */
async function touched(root: string, ref: string): Promise<string[]> {
  const diff = await run(['git', 'diff', '--name-only', `${ref}...HEAD`], root);
  if (diff.code !== 0) {
    throw new Error(`git diff ${ref}...HEAD failed:\n${diff.output}`);
  }
  const names = diff.output
    .split('\n')
    .map((file) => /^packages\/([^/]+)\//.exec(file)?.[1])
    .filter((name) => name !== undefined);
  return [...new Set(names)].sort();
}

/** Run Stryker on one package, and let it print as it goes. */
async function mutate(root: string, name: string): Promise<boolean> {
  console.log(`\nmutation: ${name} (${CONFIGS}/${name}${SUFFIX})`);
  const proc = Bun.spawn(['node_modules/.bin/stryker', 'run', join(CONFIGS, `${name}${SUFFIX}`)], {
    cwd: root,
    env: childEnv(),
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return (await proc.exited) === 0 && proc.signalCode === null;
}

export const mutation: Command = {
  name: 'mutation',
  summary: 'Run Stryker on named packages, or on the packages a branch touched',
  args: '[package...]',
  help: `
Mutation testing with Stryker, one package at a time. Each package has its
own config, stryker/<package>.conf.json: it mutates that package's src and
runs that package's tests with Stryker's command runner. A mutant the tests
let pass fails the run.

Name the packages, or give --since <ref> to run on each package with a
config whose files changed between <ref> and HEAD. One or the other; there
is no default.
`,
  flags: [{ name: 'since', takes: 'ref', help: 'Run on the packages this branch touched since <ref>' }],
  run: async ({ root, positionals, values }) => {
    const since = values('since');
    const have = await configured(root);
    if (since.length > 1 || (since.length === 1) === positionals.length > 0) {
      console.error(`Name the packages, or give one --since <ref>. Packages with a config: ${have.join(', ')}`);
      return 1;
    }
    let chosen: readonly string[] = positionals;
    const [ref] = since;
    if (ref !== undefined) {
      const changed = await touched(root, ref);
      chosen = changed.filter((name) => have.includes(name));
      const skipped = changed.filter((name) => !have.includes(name));
      if (skipped.length > 0) {
        console.log(`Touched since ${ref}, with no Stryker config: ${skipped.join(', ')}. Not mutated.`);
      }
      if (chosen.length === 0) {
        console.log(`No package with a Stryker config changed since ${ref}.`);
        return 0;
      }
    }
    const missing = chosen.filter((name) => !have.includes(name));
    if (missing.length > 0) {
      console.error(`No Stryker config for: ${missing.join(', ')}. Packages with a config: ${have.join(', ')}`);
      return 1;
    }
    const failed: string[] = [];
    for (const name of chosen) {
      if (!(await mutate(root, name))) {
        failed.push(name);
      }
    }
    if (failed.length > 0) {
      console.log(`\nMutation failed: ${failed.join(', ')}.`);
      return 1;
    }
    console.log(`\nEvery mutant was killed: ${chosen.join(', ')}.`);
    return 0;
  },
};
