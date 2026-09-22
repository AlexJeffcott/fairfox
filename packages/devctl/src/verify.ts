import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Command } from './command.ts';
import { dockerAnswers, dockerDown } from './docker.ts';
import { childEnv, seconds } from './proc.ts';

/**
 * The time limit of one run of polly verify, from its start to its end. A run
 * that does not finish inside it is red (step 0a). In eal, one check ran
 * about 8 hours, and it did not complete between 05-28 and 09-08 (L6).
 * Measured on 2026-09-22, on the owner's machine: a run takes 16 s.
 */
export const LIMIT_SECONDS = 120;

/** Where polly verify runs: the package that holds the anchored handlers and specs/verification.config.ts. */
const PACKAGE = join('packages', 'server');

type Ended = { code: number; output: string; timedOut: boolean; ms: number };

/**
 * Run polly verify in its own process group, with its output shown as it
 * comes. At the limit the whole group is stopped: polly, and the `docker run`
 * it started, which passes the signal on to TLC in the container.
 */
function runInsideLimit(root: string): Promise<Ended> {
  const started = performance.now();
  const child = spawn('bun', ['node_modules/@fairfox/polly/dist/cli/polly.js', 'verify', '--strict'], {
    cwd: join(root, PACKAGE),
    env: childEnv(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const keep = (chunk: Buffer, to: NodeJS.WriteStream) => {
    output += chunk.toString();
    to.write(chunk);
  };
  child.stdout.on('data', (chunk: Buffer) => keep(chunk, process.stdout));
  child.stderr.on('data', (chunk: Buffer) => keep(chunk, process.stderr));
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) {
      process.kill(-child.pid, 'SIGTERM');
    }
  }, LIMIT_SECONDS * 1000);
  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      resolve({ code: code ?? 1, output, timedOut, ms: Math.round(performance.now() - started) });
    });
  });
}

export const verify: Command = {
  name: 'verify',
  summary: `Run polly verify on the anchored handlers, inside ${LIMIT_SECONDS} s`,
  args: '',
  help: `
Run polly verify from ${PACKAGE}/: it reads the spec anchors in the handlers
(requires, ensures, and the state they write), generates TLA+ into
${PACKAGE}/specs/tla/generated/, and has TLC check every state the handlers
can reach, in Docker. The model's bounds are in
${PACKAGE}/specs/verification.config.ts. --strict is passed, so a declared
field that no handler writes fails the run.

The run has a time limit of ${LIMIT_SECONDS} s, from start to end. A run that does
not finish inside it is stopped and is red. polly builds its TLC image,
polly-tla, inside a machine's first run; that run may not fit.

Green needs polly to exit 0 and to print "Verification passed". Docker must
be running.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl verify takes no arguments');
      return 1;
    }
    if (!(await dockerAnswers(root))) {
      console.error(dockerDown('verify'));
      return 1;
    }
    const ended = await runInsideLimit(root);
    if (ended.timedOut) {
      console.error(`\npolly verify did not finish inside its time limit of ${LIMIT_SECONDS} s: stopped, and red.`);
      return 1;
    }
    if (ended.code !== 0 || !ended.output.includes('Verification passed')) {
      console.error(`\npolly verify failed (exit ${ended.code}) after ${seconds(ended.ms)}.`);
      return 1;
    }
    console.log(`polly verify passed in ${seconds(ended.ms)}, inside its time limit of ${LIMIT_SECONDS} s.`);
    return 0;
  },
};
