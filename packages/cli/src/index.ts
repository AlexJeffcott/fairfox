#!/usr/bin/env bun
// The Fairfox CLI: the first client of the API, through @fairfox/client (A2).
// Stryker leaves this file out (stryker/cli.conf.json): it is the command
// flow, which the @local features run as a process, and Stryker runs the
// package's unit tests only.
import { parseArgs } from 'node:util';
import { createClient } from '@fairfox/client';
import { commitOf } from './version.ts';

const USAGE = `Usage: fairfox <command> --server <origin>

Commands:
  version  Print the commit the server runs

--server is the origin of the Fairfox server, such as http://127.0.0.1:3000.
It has no default.`;

async function version(server: string): Promise<number> {
  const answer = await createClient(server).version.get();
  if (answer.error !== null) {
    // Eden gives a failed connection the status 503, with the fetch error as its value.
    const { status, value } = answer.error;
    console.error(
      value instanceof Error
        ? `Could not reach the server at ${server}: ${value.message}`
        : `The server at ${server} answered ${status}.`,
    );
    return 1;
  }
  console.log(commitOf(answer.data));
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { server: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
    strict: true,
  });
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (command !== 'version' || rest.length > 0) {
    console.error(USAGE);
    return 1;
  }
  if (values.server === undefined || values.server === '') {
    console.error('The setting --server is not set. It has no default.');
    return 1;
  }
  return version(values.server);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
