import { browser } from './browser.ts';
import { build } from './build.ts';
import { ci } from './ci.ts';
import { type Command, commandHelp } from './command.ts';
import { deploy } from './deploy.ts';
import { image } from './image.ts';
import { mutation } from './mutation.ts';
import { replica } from './replica.ts';
import { restore } from './restore.ts';
import { rollback } from './rollback.ts';
import { tlc } from './tlc.ts';
import { verify } from './verify.ts';

const intro = `devctl: the development CLI of Fairfox. It runs on a developer's machine
and never in production. Every development task is one of its commands.`;

/** The list printed by `devctl --help`, `devctl help` and `devctl` alone. */
export function topHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const list = COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`).join('\n');
  return `${intro}

Usage: devctl <command> [flags]

Commands:
${list}

Run \`devctl <command> --help\` for what a command does and its flags.
\`bun devctl <command>\`, from the root of the checkout, runs the same.
`;
}

const help: Command = {
  name: 'help',
  summary: 'List every command, or show the help of one',
  args: '[command]',
  help: `
With no command, list every command. With one, show its help: the same
as \`devctl <command> --help\`.
`,
  flags: [],
  run: async ({ positionals }) => {
    const [name, ...rest] = positionals;
    if (name === undefined) {
      console.log(topHelp());
      return 0;
    }
    const command = COMMANDS.find((c) => c.name === name);
    if (command === undefined || rest.length > 0) {
      console.error(`devctl help takes one command name. Commands: ${COMMANDS.map((c) => c.name).join(', ')}`);
      return 1;
    }
    console.log(commandHelp(command));
    return 0;
  },
};

/** Every devctl command, in the order `devctl --help` lists them. To add a command, add it here. */
export const COMMANDS: readonly Command[] = [help, build, ci, mutation, browser, tlc, verify, image, replica, restore, deploy, rollback];
