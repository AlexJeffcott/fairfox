// The command polly mutate's command runner runs for the shell
// (packages/shell/polly.mutate.ts), once for the tests as they are and once
// for each mutant: build the shell, run the @browser feature in WebKit, then
// build the shell again as it is, so that no mutant is left in
// packages/shell/dist/.
//
// The runner names the mutant in POLLY_MUTATE_FILE and POLLY_MUTATE_SPAN, and
// its preload swaps the text in each Bun process the command starts. The
// shell runs in WebKit, from a bundle, which that preload does not reach, so
// the build is given polly's bundler plugin, which reads the same two
// variables. With them unset, as for the tests as they are, it does nothing.
import { join } from 'node:path';
import { pollyMutatePlugin } from '@fairfox/polly/mutate';
import type { BunPlugin } from 'bun';

const root = join(import.meta.dir, '..', '..', '..');
const page = join(root, 'packages', 'shell', 'src', 'index.html');
const outdir = join(root, 'packages', 'shell', 'dist');

async function build(plugin: BunPlugin): Promise<void> {
  const built = await Bun.build({ entrypoints: [page], target: 'browser', outdir, plugins: [plugin] });
  if (!built.success) {
    for (const log of built.logs) {
      console.error(log);
    }
    process.exit(1);
  }
}

async function step(argv: readonly string[]): Promise<number> {
  const proc = Bun.spawn([...argv], { cwd: root, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  return proc.signalCode === null ? code : 1;
}

await build(pollyMutatePlugin());
let code = await step(['bun', 'node_modules/playwright-bdd/dist/cli/index.js']);
if (code === 0) {
  code = await step(['bun', 'node_modules/@playwright/test/cli.js', 'test']);
}
// The shell as it is: the plugin is given no mutant.
await build(pollyMutatePlugin({}));
process.exit(code);
