// Check "pins": Preact, Signals and polly are each pinned to one exact version
// (M12), the same in every package.json, and bun.lock holds one copy of each.
// A range lets an install move a framework without a step of its own; a
// second copy puts two Preacts, or two signal graphs, in one page. polly
// 0.82.1 pins its own Preact and Signals exactly, so the shell pins the same
// versions, or the lockfile holds two.
import { join } from 'node:path';
import { PACKAGES } from '../build.ts';
import { repoRoot } from '../repo.ts';

/** The framework of the screens. An upgrade of one is its own step (M12). */
const FRAMEWORK = ['preact', '@preact/signals', '@fairfox/polly'];
/** One copy each. Signals' core too: two copies are two signal graphs. */
const ONE_COPY = [...FRAMEWORK, '@preact/signals-core'];
const EXACT = /^\d+\.\d+\.\d+$/;

/** The object at `key`, or an empty one. */
function objectAt(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const inner: unknown = Reflect.get(value, key);
  return typeof inner === 'object' && inner !== null ? Object.fromEntries(Object.entries(inner)) : {};
}

const root = await repoRoot();
const problems: string[] = [];
const pinned = new Map<string, string>();

const manifests = ['package.json', ...PACKAGES.map((p) => join('packages', p.name, 'package.json'))];
for (const file of manifests) {
  const manifest: unknown = JSON.parse(await Bun.file(join(root, file)).text());
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = objectAt(manifest, field);
    for (const name of FRAMEWORK) {
      const spec = deps[name];
      if (typeof spec !== 'string') {
        continue;
      }
      if (!EXACT.test(spec)) {
        problems.push(`${file} gives ${name} as ${spec}, not one exact version`);
      }
      const before = pinned.get(name);
      if (before !== undefined && before !== spec) {
        problems.push(`${name} is ${before} in one package.json and ${spec} in ${file}`);
      }
      pinned.set(name, spec);
    }
  }
}

const lock: unknown = Bun.JSONC.parse(await Bun.file(join(root, 'bun.lock')).text());
const resolved = Object.values(objectAt(lock, 'packages')).map((entry) =>
  Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : '',
);
for (const name of ONE_COPY) {
  const versions = [...new Set(resolved.filter((id) => id.startsWith(`${name}@`)).map((id) => id.slice(name.length + 1)))];
  if (versions.length !== 1) {
    problems.push(`bun.lock holds ${versions.length} copies of ${name}: ${versions.join(', ') || 'none'}`);
  }
  const pin = pinned.get(name);
  if (FRAMEWORK.includes(name) && pin === undefined) {
    problems.push(`no package.json pins ${name}`);
  }
  if (pin !== undefined && versions.some((v) => v !== pin)) {
    problems.push(`${name} is pinned to ${pin}, and bun.lock holds ${versions.join(', ')}`);
  }
}

if (problems.length > 0) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log(`${FRAMEWORK.map((n) => `${n} ${pinned.get(n)}`).join(', ')}: each pinned to one exact version, one copy each.`);
