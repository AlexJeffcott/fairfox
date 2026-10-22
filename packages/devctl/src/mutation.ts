import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from './command.ts';
import { childEnv, run } from './proc.ts';

/**
 * Mutation testing with polly mutate, one package at a time, each with its
 * own config, packages/<package>/polly.mutate.ts, that names the files it
 * mutates and the tests that run them. A config's break threshold is 100: one
 * mutant that the tests let pass fails the run. The defect it catches: a test
 * that passes when the code is wrong (L6, "test gaps"). What a config leaves
 * out of its package, and why, is written in the config.
 */
const CONFIG = 'polly.mutate.ts';
/** Where polly mutate writes its report, from the directory of the config: its default. */
const REPORT = join('reports', 'mutation', 'mutation.json');

/**
 * The packages with no mutation config, each with the reason. `--since` fails
 * on a package it touched that has neither a config nor an entry here.
 */
export const EXEMPT: Readonly<Record<string, string>> = {
  client: "no logic of its own: createClient is one call to Eden's treaty",
  permissions: 'no code yet: the list is empty until stage 1',
};

/** The config of a package, from the root of the checkout. */
function configOf(name: string): string {
  return join('packages', name, CONFIG);
}

/** The packages that have a mutation config. */
async function configured(root: string): Promise<string[]> {
  const entries = await readdir(join(root, 'packages'), { withFileTypes: true });
  const have: string[] = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    if (await Bun.file(join(root, configOf(entry.name))).exists()) {
      have.push(entry.name);
    }
  }
  return have.sort();
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

/** Run polly mutate on one package, and let it print as it goes. */
async function mutate(root: string, name: string): Promise<boolean> {
  console.log(`\nmutation: ${name} (${configOf(name)})`);
  const proc = Bun.spawn(['node_modules/.bin/polly', 'mutate', 'run', '--config', configOf(name)], {
    cwd: root,
    env: childEnv(),
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const ok = (await proc.exited) === 0 && proc.signalCode === null;
  if (!ok) {
    await printSurvivors(root, name);
  }
  return ok;
}

/** The statuses of a mutant that no test killed. */
const UNKILLED = ['Survived', 'NoCoverage'];

/**
 * Print each mutant no test killed, as `packages/<name>/<file>:<line>:<column>
 * <mutator> <status>`, from the report polly mutate writes. polly prints its
 * own list only when the score reaches the break threshold, so a failed run
 * names no survivor without this.
 */
async function printSurvivors(root: string, name: string): Promise<void> {
  const path = join(root, 'packages', name, REPORT);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.error(`No mutation report at ${path}`);
    return;
  }
  const report: unknown = await file.json();
  const files = typeof report === 'object' && report !== null && 'files' in report ? report.files : undefined;
  if (typeof files !== 'object' || files === null) {
    console.error(`The mutation report at ${path} has no files`);
    return;
  }
  for (const [source, entry] of Object.entries(files)) {
    const mutants: unknown = typeof entry === 'object' && entry !== null && 'mutants' in entry ? entry.mutants : [];
    for (const m of Array.isArray(mutants) ? mutants : []) {
      if (UNKILLED.includes(m.status)) {
        const at = m.location.start;
        console.log(`unkilled: ${join('packages', name, source)}:${at.line}:${at.column} ${m.mutatorName} ${m.status}`);
      }
    }
  }
}

export const mutation: Command = {
  name: 'mutation',
  summary: 'Run polly mutate on named packages, or on the packages a branch touched',
  args: '[package...]',
  help: `
Mutation testing with polly mutate, one package at a time. Each package has
its own config, packages/<package>/polly.mutate.ts: it names the files it
mutates and the tests that run them. A mutant the tests let pass fails the
run.

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
      console.error(`Both a mutation config and an exemption: ${both.join(', ')}. Remove the exemption from EXEMPT.`);
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
            `packages/${name} changed since ${ref} and has no mutation config (${configOf(name)}) and no reason in EXEMPT (packages/devctl/src/mutation.ts).`,
          );
        }
        return 1;
      }
      chosen = changed.filter((name) => have.includes(name));
      if (chosen.length === 0) {
        console.log(`No package with a mutation config changed since ${ref}.`);
        return 0;
      }
    }
    const missing = chosen.filter((name) => !have.includes(name));
    if (missing.length > 0) {
      console.error(`No mutation config for: ${missing.join(', ')}. Packages with a config: ${have.join(', ')}`);
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
