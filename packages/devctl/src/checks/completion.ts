// Check "completion": completions/devctl.zsh names the same commands, flags and
// packages as the command table. It is written by hand, so it can drift (L7).
import { join } from 'node:path';
import { PACKAGES } from '../build.ts';
import { COMMANDS } from '../commands.ts';
import { repoRoot } from '../repo.ts';

const root = await repoRoot();
const file = 'completions/devctl.zsh';
const text = await Bun.file(join(root, file)).text();
const problems: string[] = [];

function differ(what: string, inFile: readonly string[], inTable: readonly string[]): void {
  const missing = inTable.filter((x) => !inFile.includes(x));
  const extra = inFile.filter((x) => !inTable.includes(x));
  if (missing.length > 0) {
    problems.push(`${file} lacks ${what}: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    problems.push(`${file} names ${what} devctl does not have: ${extra.join(', ')}`);
  }
}

// The commands: one 'name:summary' line each inside `commands=( ... )`.
const block = /commands=\(\n([\s\S]*?)\n\s*\)/.exec(text)?.[1] ?? '';
const commands = [...block.matchAll(/^\s*'([a-z-]+):/gm)].map((m) => m[1] ?? '');
differ('commands', commands, COMMANDS.map((c) => c.name));

// The flags: each command's branch of `case $cmd in`, from `name)` to `;;`.
for (const command of COMMANDS) {
  const branch = new RegExp(`^\\s*${command.name}\\)\\n([\\s\\S]*?);;`, 'm').exec(text)?.[1] ?? '';
  const flags = [...branch.matchAll(/'\*?--([a-z-]+)\[/g)].map((m) => m[1] ?? '');
  differ(`flags of ${command.name}`, flags, command.flags.map((f) => f.name));
}

// The packages `devctl build` takes.
const packages = /'\*:package:\(([^)]*)\)'/.exec(text)?.[1]?.split(/\s+/) ?? [];
differ('packages of build', packages, PACKAGES.map((p) => p.name));

if (problems.length > 0) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log(`${file} names every command, flag and package.`);
