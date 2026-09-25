/**
 * The steps of answering-the-version.feature. The server runs in this
 * process, on a local port, with an empty in-memory SQLite database. The
 * typed client asks it in this process (M9). The CLI runs as its own process
 * and reaches it over HTTP. Settings are passed as arguments, and the CLI's
 * process gets an empty environment: nothing is read from this process's
 * environment or from a .env file (C2).
 */
import { expect } from 'bun:test';
import { join } from 'node:path';
// The server and the client are imported by path, not by package name: under
// Stryker, which links the root node_modules into its copy of the tree, a
// package name would reach the server that is not mutated.
import { type Client, createClient } from '../../packages/client/src/index.ts';
import { type App, createApp } from '../../packages/server/src/index.ts';
import type { StepDefinition } from './gherkin.ts';

type Answer = Awaited<ReturnType<Client['version']['get']>>;
type Ran = { code: number; stdout: string; stderr: string };

export type World = {
  server: App | undefined;
  origin: string | undefined;
  startError: unknown;
  answer: Answer | undefined;
  cli: Ran | undefined;
};

export function newWorld(): World {
  return { server: undefined, origin: undefined, startError: undefined, answer: undefined, cli: undefined };
}

export async function dispose(world: World): Promise<void> {
  await world.server?.stop();
}

const CLI = join(import.meta.dir, '..', '..', 'packages', 'cli', 'src', 'index.ts');

/** The headers HTTP itself needs. Any other header in the answer says something more than the commit. */
const TRANSPORT_HEADERS: readonly string[] = [
  'connection',
  'content-length',
  'content-type',
  'date',
  'keep-alive',
  'transfer-encoding',
];

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`No ${what}: an earlier step did not set it.`);
  }
  return value;
}

/** Start a server on a free local port, and keep it in the world. */
function start(world: World, settings: Readonly<Record<string, string>>): void {
  const server = createApp(settings).listen({ hostname: '127.0.0.1', port: 0 });
  world.server = server;
  world.origin = must(server.server?.url.origin, 'address the server listens on');
}

export const steps: readonly StepDefinition<World>[] = [
  {
    pattern: /a server running commit "([^"]+)"/,
    run: (world, commit) => {
      start(world, { FAIRFOX_COMMIT: commit, FAIRFOX_DATABASE_PATH: ':memory:', FAIRFOX_TURN_SECRET: 'local' });
    },
  },
  {
    pattern: /the client asks the server for its version/,
    run: async (world) => {
      world.answer = await createClient(must(world.origin, 'server')).version.get();
    },
  },
  {
    pattern: /the answer is the commit "([^"]+)"/,
    run: (world, commit) => {
      const answer = must(world.answer, 'answer');
      expect(answer.error).toBeNull();
      expect(answer.data?.commit).toBe(commit);
    },
  },
  {
    pattern: /the answer holds nothing but the commit/,
    run: (world) => {
      const answer = must(world.answer, 'answer');
      expect(Object.keys(answer.data ?? {})).toEqual(['commit']);
      const headers = [...answer.response.headers.keys()];
      expect(headers.filter((name) => !TRANSPORT_HEADERS.includes(name))).toEqual([]);
    },
  },
  {
    pattern: /the CLI's version command is run against that server/,
    run: async (world) => {
      const proc = Bun.spawn([process.execPath, CLI, 'version', '--server', must(world.origin, 'server')], {
        env: {},
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      world.cli = { code, stdout, stderr };
    },
  },
  {
    pattern: /the CLI prints the commit "([^"]+)"/,
    run: (world, commit) => {
      const cli = must(world.cli, 'run of the CLI');
      expect(cli.stderr).toBe('');
      expect(cli.code).toBe(0);
      expect(cli.stdout).toBe(`${commit}\n`);
    },
  },
  {
    pattern: /a server is started with no commit set/,
    run: (world) => {
      try {
        start(world, { FAIRFOX_DATABASE_PATH: ':memory:' });
      } catch (error) {
        world.startError = error;
      }
    },
  },
  {
    pattern: /the server does not start/,
    run: (world) => {
      expect(world.server).toBeUndefined();
      expect(world.startError).toBeInstanceOf(Error);
    },
  },
  {
    pattern: /the error names the missing commit setting/,
    run: (world) => {
      expect(String(world.startError)).toContain('FAIRFOX_COMMIT');
    },
  },
];
