import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { anchoredRoutesIn, includedRoutes } from './anchors.ts';
import type { Command } from './command.ts';
import { dockerAnswers, dockerDown } from './docker.ts';
import { childEnv, run, seconds } from './proc.ts';
import { JAVA_IMAGE, problems, tlaTools } from './tlc.ts';

/**
 * The time limit of one run of polly verify, from its start to its end. A run
 * that does not finish inside it is red (step 0a). In eal, one check ran
 * about 8 hours, and it did not complete between 05-28 and 09-08 (L6).
 * Measured on 2026-09-22, on the owner's machine: a run takes 16 s.
 */
export const LIMIT_SECONDS = 120;

/** Where polly verify runs: the package that holds the anchored handlers and specs/verification.config.ts. */
const PACKAGE = join('packages', 'server');

/** Where polly writes the TLA+ it generates, and runs TLC. */
const GENERATED = join(PACKAGE, 'specs', 'tla', 'generated');

/**
 * Whether the routes polly will model are the anchored ones: every route in
 * the package's src whose handler calls requires or ensures, each named in
 * messages.include of the config, and nothing else named there. polly leaves
 * a route out of the model when include does not name it, and its run stays
 * green. Returns what differs, or an empty list.
 */
async function modelDrift(root: string): Promise<string[]> {
  const config = join(PACKAGE, 'specs', 'verification.config.ts');
  const anchored = await anchoredRoutesIn(join(root, PACKAGE, 'src'));
  const included = await includedRoutes(join(root, config));
  const drift: string[] = [];
  const missing = anchored.filter((route) => !included.includes(route));
  if (missing.length > 0) {
    drift.push(`Anchored routes missing from messages.include in ${config}: ${missing.join(', ')}.`);
  }
  const extra = included.filter((route) => !anchored.includes(route));
  if (extra.length > 0) {
    drift.push(`Names in messages.include with no anchored route in ${PACKAGE}/src: ${extra.join(', ')}.`);
  }
  return drift;
}

/** The TLC image polly runs. polly gives it this name; nothing here can change it. */
const POLLY_IMAGE = 'polly-tla:latest';

/**
 * Build polly's TLC image from pinned inputs, over any image of that name
 * already on the machine: Java by digest and the jar checked by hash, the
 * same two devctl tlc runs on. Returns what went wrong, or null.
 */
async function buildPollyImage(root: string): Promise<string | null> {
  const jar = await tlaTools(root);
  const built = await run(
    [
      'docker', 'build', '--tag', POLLY_IMAGE,
      '--build-arg', `JAVA_IMAGE=${JAVA_IMAGE}`,
      '--build-arg', `TLA_JAR=${basename(jar)}`,
      '--build-context', `tools=${dirname(jar)}`,
      join('packages', 'devctl', 'polly-tla'),
    ],
    root,
  );
  return built.code === 0 ? null : built.output;
}

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
${GENERATED}/, and has TLC check every state of that model, in
Docker. The model's bounds are in ${PACKAGE}/specs/verification.config.ts.
--strict is passed, so a declared field that no handler writes fails the
run. polly checks the model it builds from the anchors, not the code.

Before polly runs, the routes in the model are compared with the anchored
routes of ${PACKAGE}/src: each route whose handler calls requires or ensures
from @fairfox/polly/verify, found with the TypeScript compiler. A route
missing from messages.include, or a name there with no anchored route, fails
the run: polly would leave the route out of its model and stay green.

First it builds ${POLLY_IMAGE}, the image polly runs TLC in, from
packages/devctl/polly-tla/: Java by digest and tla2tools.jar checked by
hash, as devctl tlc runs them. A leftover image of that name is never used.
The image keeps TLC's whole output in ${GENERATED}/tlc.log.

The run of polly has a time limit of ${LIMIT_SECONDS} s. A run that does not finish
inside it is stopped and is red. Green needs polly to exit 0 and print
"Verification passed", and TLC's own output to show that it completed: no
error, nothing left on the queue, more states than the initial ones. The
command prints TLC's real state count; polly's own "Distinct states" line is
the first number its pattern meets. Docker must be running.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl verify takes no arguments');
      return 1;
    }
    const drift = await modelDrift(root);
    if (drift.length > 0) {
      console.error(`${drift.join('\n')}\npolly verify is not run: its model would not be the anchored routes.`);
      return 1;
    }
    if (!(await dockerAnswers(root))) {
      console.error(dockerDown('verify'));
      return 1;
    }
    const failedBuild = await buildPollyImage(root);
    if (failedBuild !== null) {
      console.error(`${failedBuild.trimEnd()}\n\nThe build of ${POLLY_IMAGE} failed: polly verify is not run.`);
      return 1;
    }
    const log = join(root, GENERATED, 'tlc.log');
    await mkdir(join(root, GENERATED), { recursive: true });
    await rm(log, { force: true });
    await Bun.write(join(root, GENERATED, '.keep-tlc-log'), 'devctl verify reads tlc.log\n');

    const ended = await runInsideLimit(root);
    if (ended.timedOut) {
      console.error(`\npolly verify did not finish inside its time limit of ${LIMIT_SECONDS} s: stopped, and red.`);
      return 1;
    }
    if (ended.code !== 0 || !ended.output.includes('Verification passed')) {
      console.error(`\npolly verify failed (exit ${ended.code}) after ${seconds(ended.ms)}.`);
      return 1;
    }
    if (!(await Bun.file(log).exists())) {
      console.error(`\nTLC left no ${GENERATED}/tlc.log: polly did not run TLC in the ${POLLY_IMAGE} devctl verify built.`);
      return 1;
    }
    const tlcOutput = await Bun.file(log).text();
    const found = problems(tlcOutput, 0);
    if (found.length > 0) {
      console.error(`\npolly said it passed, and TLC's own output says otherwise (${GENERATED}/tlc.log):`);
      for (const problem of found) {
        console.error(`  - ${problem}`);
      }
      return 1;
    }
    const summary = /(\d+) states generated, (\d+) distinct states found/.exec(tlcOutput);
    console.log(
      `\nTLC completed: ${summary?.[2]} distinct states, ${summary?.[1]} generated, 0 left on queue.` +
        `\npolly verify passed in ${seconds(ended.ms)}, inside its time limit of ${LIMIT_SECONDS} s.`,
    );
    return 0;
  },
};
