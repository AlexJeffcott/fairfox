// The command Stryker's command runner runs for the shell
// (stryker/shell.conf.json), in Stryker's sandbox, once for the tests as they
// are and once for each mutant: build the shell, then run the @browser
// feature in WebKit. It runs from the sandbox, the directory Stryker starts it
// in, and not through devctl, whose root is the git checkout around it.
//
// The command runner names the active mutant in __STRYKER_ACTIVE_MUTANT__;
// that variable is how it talks to the code it runs. Stryker's instrumented
// code reads it from process.env, which a page in WebKit does not have, so
// the built page is given the mutant first, in an inline script that runs
// before the shell's own.
import { join } from 'node:path';

const root = process.cwd();
const mutant = process.env.__STRYKER_ACTIVE_MUTANT__ ?? '';

async function step(argv: readonly string[]): Promise<void> {
  const proc = Bun.spawn([...argv], { cwd: root, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0 || proc.signalCode !== null) {
    console.error(`Failed (exit ${code}): ${argv.join(' ')}`);
    process.exit(1);
  }
}

await step(['bun', 'build', 'packages/shell/src/index.html', '--target', 'browser', '--outdir', 'packages/shell/dist']);

const page = join(root, 'packages', 'shell', 'dist', 'index.html');
const html = await Bun.file(page).text();
if (!html.includes('<head>')) {
  console.error(`${page} has no <head> to give the mutant to`);
  process.exit(1);
}
await Bun.write(
  page,
  html.replace('<head>', `<head><script>globalThis.__stryker__ = { activeMutant: ${JSON.stringify(mutant)} };</script>`),
);

await step(['bun', 'node_modules/playwright-bdd/dist/cli/index.js']);
await step(['bun', 'node_modules/@playwright/test/cli.js', 'test']);
