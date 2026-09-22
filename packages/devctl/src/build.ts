import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from './command.ts';
import { run, seconds } from './proc.ts';

/**
 * Every package of the workspace, and where its bundle runs. Each package's
 * entry is `packages/<name>/src/index.ts`; its bundle goes to
 * `packages/<name>/dist/`. `devctl build` fails on a directory under
 * `packages/` that is not listed here.
 */
export const PACKAGES: readonly { name: string; target: 'bun' | 'browser' }[] = [
  { name: 'server', target: 'bun' },
  { name: 'client', target: 'browser' },
  { name: 'cli', target: 'bun' },
  { name: 'shell', target: 'browser' },
  { name: 'permissions', target: 'browser' },
  { name: 'devctl', target: 'bun' },
];

type Built = { name: string; ok: boolean; ms: number; output: string };

async function buildOne(root: string, name: string, target: 'bun' | 'browser'): Promise<Built> {
  const dir = join('packages', name);
  const types = await run(['bun', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', join(dir, 'tsconfig.json')], root);
  if (types.code !== 0) {
    return { name, ok: false, ms: types.ms, output: types.output };
  }
  const bundle = await run(
    ['bun', 'build', join(dir, 'src', 'index.ts'), '--target', target, '--outdir', join(dir, 'dist')],
    root,
  );
  return { name, ok: bundle.code === 0, ms: types.ms + bundle.ms, output: bundle.code === 0 ? '' : bundle.output };
}

/** Directories under `packages/` that hold a package.json and are missing from PACKAGES. */
async function unlisted(root: string): Promise<string[]> {
  const entries = await readdir(join(root, 'packages'), { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const listed = new Set(PACKAGES.map((p) => p.name));
  const found: string[] = [];
  for (const dir of dirs) {
    if (!listed.has(dir) && (await Bun.file(join(root, 'packages', dir, 'package.json')).exists())) {
      found.push(dir);
    }
  }
  return found;
}

export const build: Command = {
  name: 'build',
  summary: 'Type-check and bundle each package of the workspace',
  args: '[package...]',
  help: `
Type-check each package with tsc (strict, no emit), then bundle its
src/index.ts with Bun into packages/<name>/dist/. With no package named,
build all of them: ${PACKAGES.map((p) => p.name).join(', ')}.

Fails when a package fails, and when a directory under packages/ holds a
package.json but is missing from PACKAGES in packages/devctl/src/build.ts.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    const missing = await unlisted(root);
    if (missing.length > 0) {
      for (const dir of missing) {
        console.error(`packages/${dir} is not in the build table: add it to PACKAGES in packages/devctl/src/build.ts`);
      }
      return 1;
    }
    const unknown = positionals.filter((name) => !PACKAGES.some((p) => p.name === name));
    if (unknown.length > 0) {
      console.error(`Unknown package: ${unknown.join(', ')}. Packages: ${PACKAGES.map((p) => p.name).join(', ')}`);
      return 1;
    }
    const chosen = positionals.length === 0 ? PACKAGES : PACKAGES.filter((p) => positionals.includes(p.name));
    const results = await Promise.all(chosen.map((p) => buildOne(root, p.name, p.target)));
    const width = Math.max(...results.map((r) => r.name.length));
    for (const r of results) {
      console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(width)}  ${seconds(r.ms)}`);
      if (!r.ok) {
        console.log(r.output.trimEnd());
      }
    }
    return results.every((r) => r.ok) ? 0 : 1;
  },
};
