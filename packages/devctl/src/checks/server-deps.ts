// Check "server-deps": every runtime dependency of the server is a package
// that code reached from its entry, packages/server/src/index.ts, imports at
// run time. A package the running server never loads, listed in
// `dependencies`, ships to production for nothing, with everything it brings:
// polly as a runtime dependency brought ts-morph for a route nothing mounts.
// A package that only tests, checks or anchors need is a devDependency.
import { dirname, join, resolve } from 'node:path';
import { repoRoot } from '../repo.ts';

const root = await repoRoot();
const manifestFile = join('packages', 'server', 'package.json');
const entry = join(root, 'packages', 'server', 'src', 'index.ts');

/** The package a bare import names: `@scope/name` or `name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return (specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });
const imported = new Set<string>();
const seen = new Set<string>();
const queue = [entry];
for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
  if (seen.has(file)) {
    continue;
  }
  seen.add(file);
  // Type-only imports are not in the scan: they are gone at run time.
  for (const found of transpiler.scanImports(await Bun.file(file).text())) {
    if (found.path.startsWith('.')) {
      queue.push(resolve(dirname(file), found.path));
    } else if (!found.path.startsWith('node:') && !found.path.startsWith('bun:')) {
      imported.add(packageOf(found.path));
    }
  }
}

const manifest: unknown = JSON.parse(await Bun.file(join(root, manifestFile)).text());
const dependencies: unknown = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'dependencies') : undefined;
const runtime = typeof dependencies === 'object' && dependencies !== null ? Object.keys(dependencies) : [];
const unused = runtime.filter((name) => !imported.has(name));

if (unused.length > 0) {
  console.log(
    `${manifestFile} lists ${unused.join(', ')} in dependencies, and nothing the server's entry reaches imports it at run time. Make it a devDependency.`,
  );
  process.exit(1);
}
console.log(`The server's runtime dependencies, ${runtime.join(', ')}, are each imported from its entry.`);
