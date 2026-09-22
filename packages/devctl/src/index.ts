#!/usr/bin/env bun
import { commandHelp, parseInput } from './command.ts';
import { COMMANDS, topHelp } from './commands.ts';
import { repoRoot } from './repo.ts';

async function main(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h') {
    console.log(topHelp());
    return 0;
  }
  const command = COMMANDS.find((c) => c.name === name);
  if (command === undefined) {
    console.error(`Unknown command: ${name}\n`);
    console.error(topHelp());
    return 1;
  }
  const input = parseInput(command, await repoRoot(), rest);
  if (input.help) {
    console.log(commandHelp(command));
    return 0;
  }
  return command.run(input);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
