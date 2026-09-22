import { parseArgs } from 'node:util';

/** A flag of one command. With `takes` it takes a value and may be given more than once. */
export type Flag = {
  name: string;
  takes?: string;
  help: string;
};

export type Input = {
  root: string;
  positionals: readonly string[];
  /** Whether a flag without a value was given. */
  flag: (name: string) => boolean;
  /** Every value given to a flag that takes one, in order. */
  values: (name: string) => readonly string[];
};

/**
 * One devctl command. `devctl --help`, `devctl <name> --help` and the zsh
 * completion are all read from these fields.
 */
export type Command = {
  name: string;
  /** One line, for the list in `devctl --help`. */
  summary: string;
  /** What follows `devctl <name>`, for example `[package...]`. */
  args: string;
  /** What the command does, for `devctl <name> --help`. */
  help: string;
  flags: readonly Flag[];
  /** Returns the exit code. */
  run: (input: Input) => Promise<number>;
};

export function usage(command: Command): string {
  const flags = command.flags.map((f) => (f.takes ? `[--${f.name} <${f.takes}>]` : `[--${f.name}]`));
  return ['Usage: devctl', command.name, command.args, ...flags].filter((part) => part !== '').join(' ');
}

export function commandHelp(command: Command): string {
  const rows = [
    ...command.flags.map((f) => ({ left: f.takes ? `--${f.name} <${f.takes}>` : `--${f.name}`, help: f.help })),
    { left: '-h, --help', help: 'Show this help' },
  ];
  const width = Math.max(...rows.map((r) => r.left.length));
  const flags = rows.map((r) => `  ${r.left.padEnd(width)}  ${r.help}`).join('\n');
  return `${usage(command)}\n\n${command.help.trim()}\n\nFlags:\n${flags}\n`;
}

/** Parse what follows the command name. Unknown flags fail loud. */
export function parseInput(command: Command, root: string, argv: readonly string[]): Input & { help: boolean } {
  const options: Record<string, { type: 'string' | 'boolean'; multiple?: boolean; short?: string }> = {
    help: { type: 'boolean', short: 'h' },
  };
  for (const f of command.flags) {
    options[f.name] = f.takes ? { type: 'string', multiple: true } : { type: 'boolean' };
  }
  const { values, positionals } = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  const flag = (name: string): boolean => values[name] === true;
  const valuesOf = (name: string): readonly string[] => {
    const given = values[name];
    return Array.isArray(given) ? given.filter((v) => typeof v === 'string') : [];
  };
  return { root, positionals, flag, values: valuesOf, help: flag('help') };
}
