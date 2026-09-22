import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from './command.ts';
import { childEnv, run } from './proc.ts';

/**
 * Stryker mutation testing, as in lingua: one package at a time, each with its
 * own config, stryker/<package>.conf.json, that mutates that package's src and
 * runs that package's tests with Stryker's command runner. No patch. A
 * config's break threshold is 100: one mutant that the tests let pass fails
 * the run. The defect it catches: a test that passes when the code is wrong
 * (L6, "test gaps"). A config that leaves a file out says why at the top of
 * that file.
 */
const CONFIGS = 'stryker';
const SUFFIX = '.conf.json';

/**
 * The packages with no Stryker config, each with the reason. `--since` fails
 * on a package it touched that has neither a config nor an entry here.
 */
export const EXEMPT: Readonly<Record<string, string>> = {
  shell: 'no code yet: the shell is built at step 7b',
  client: "no logic of its own: createClient is one call to Eden's treaty",
  server:
    'no business logic yet (step 0a): its one behaviour is the @local version feature, which M1 does not let a unit test repeat. Its first logic comes at stage 1',
  devctl: 'the development CLI that runs these checks, not the product: each check is seen red by devctl ci --red (M3)',
  permissions: 'no code yet: the list is empty until stage 1',
};

/** The packages that have a Stryker config. */
async function configured(root: string): Promise<string[]> {
  const files = await readdir(join(root, CONFIGS));
  return files
    .filter((f) => f.endsWith(SUFFIX))
    .map((f) => f.slice(0, -SUFFIX.length))
    .sort();
}

/**
 * The packages whose files changed between `ref` and HEAD, on this branch:
 * `git diff ref...HEAD`, from the merge base. A package that no longer exists
 * has nothing to mutate and is left out.
 */
async function touched(root: string, ref: string): Promise<string[]> {
  const diff = await run(['git', 'diff', '--name-only', `${ref}...HEAD`], root);
  if (diff.code !== 0) {
    throw new Error(`git diff ${ref}...HEAD failed:\n${diff.output}`);
  }
  const names = new Set(
    diff.output
      .split('\n')
      .map((file) => /^packages\/([^/]+)\//.exec(file)?.[1])
      .filter((name) => name !== undefined),
  );
  const present: string[] = [];
  for (const name of names) {
    if (await Bun.file(join(root, 'packages', name, 'package.json')).exists()) {
      present.push(name);
    }
  }
  return present.sort();
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

Name the packages, or give --since <ref> to run on each package whose files
changed between the merge base of <ref> and HEAD. With --since, a touched
package with no config fails the run, unless EXEMPT in
packages/devctl/src/mutation.ts gives the reason it has none. devctl ci runs
--since main. One or the other; there is no default.
`,
  flags: [{ name: 'since', takes: 'ref', help: 'Run on the packages this branch touched since the merge base of <ref>' }],
  run: async ({ root, positionals, values }) => {
    const since = values('since');
    const have = await configured(root);
    if (since.length > 1 || (since.length === 1) === positionals.length > 0) {
      console.error(`Name the packages, or give one --since <ref>. Packages with a config: ${have.join(', ')}`);
      return 1;
    }
    const both = have.filter((name) => name in EXEMPT);
    if (both.length > 0) {
      console.error(`Both a Stryker config and an exemption: ${both.join(', ')}. Remove the exemption from EXEMPT.`);
      return 1;
    }
    let chosen: readonly string[] = positionals;
    const [ref] = since;
    if (ref !== undefined) {
      const changed = await touched(root, ref);
      for (const name of changed.filter((n) => n in EXEMPT)) {
        console.log(`Not mutated: ${name}: ${EXEMPT[name]}`);
      }
      const bare = changed.filter((name) => !have.includes(name) && !(name in EXEMPT));
      if (bare.length > 0) {
        for (const name of bare) {
          console.error(
            `packages/${name} changed since ${ref} and has no Stryker config (${CONFIGS}/${name}${SUFFIX}) and no reason in EXEMPT (packages/devctl/src/mutation.ts).`,
          );
        }
        return 1;
      }
      chosen = changed.filter((name) => have.includes(name));
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
