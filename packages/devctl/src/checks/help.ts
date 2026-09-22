// Check "help": `devctl --help` lists every command, and every command has help.
// It runs devctl as a developer or an agent does, and reads what it prints.
import { COMMANDS } from '../commands.ts';
import { run } from '../proc.ts';
import { repoRoot } from '../repo.ts';

const root = await repoRoot();
const devctl = ['bun', 'packages/devctl/src/index.ts'];
const problems: string[] = [];

const top = await run([...devctl, '--help'], root);
const listed = top.output.split('\n').map((l) => l.trim().split(/\s+/)[0]);
if (top.code !== 0) {
  problems.push(`devctl --help exited ${top.code}`);
}
for (const command of COMMANDS) {
  if (!listed.includes(command.name)) {
    problems.push(`devctl --help does not list ${command.name}`);
  }
  const own = await run([...devctl, command.name, '--help'], root);
  if (own.code !== 0 || !own.output.startsWith(`Usage: devctl ${command.name}`)) {
    problems.push(`devctl ${command.name} --help prints no usage (exit ${own.code})`);
  }
}

if (problems.length > 0) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log(`devctl --help lists ${COMMANDS.length} commands; each has help.`);
