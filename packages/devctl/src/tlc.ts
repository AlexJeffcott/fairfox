import { mkdir, readdir, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Command } from './command.ts';
import { dockerAnswers, dockerDown } from './docker.ts';
import { run, seconds } from './proc.ts';

/**
 * TLC, pinned: the release of tla2tools.jar and its SHA-256. The jar is
 * downloaded once into .devctl/tools/, and its hash is checked before every
 * run. 1.7.4 is TLC 2.19, the release polly's own TLC image downloads.
 */
export const TLA_TOOLS = {
  version: '1.7.4',
  url: 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar',
  sha256: '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88',
};

/**
 * The Java that runs TLC. The developer's machine has no Java runtime, so
 * TLC runs in a container: eclipse-temurin 21, pinned by the digest of its
 * image index.
 */
export const JAVA_IMAGE = 'eclipse-temurin:21-jre@sha256:49e21e16e3c86eb7816a44a67549910ed090fbeb40c29c525d58bf5e02e91b0f';

/** The hand-written specs: one directory each, holding `<Module>.tla` and `<Module>.cfg`. */
const SPECS = join('specs', 'tla');

function sha256(bytes: ArrayBuffer): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

/** The pinned jar, downloaded when missing. Throws when its hash is not the pinned one. */
export async function tlaTools(root: string): Promise<string> {
  const dir = join(root, '.devctl', 'tools');
  const jar = join(dir, `tla2tools-${TLA_TOOLS.version}.jar`);
  if (!(await Bun.file(jar).exists())) {
    console.log(`Downloading tla2tools.jar ${TLA_TOOLS.version} from ${TLA_TOOLS.url}`);
    await mkdir(dir, { recursive: true });
    const response = await fetch(TLA_TOOLS.url);
    if (!response.ok) {
      throw new Error(`Download of tla2tools.jar failed: HTTP ${response.status}`);
    }
    const part = `${jar}.part`;
    await Bun.write(part, await response.arrayBuffer());
    await rename(part, jar);
  }
  const found = sha256(await Bun.file(jar).arrayBuffer());
  if (found !== TLA_TOOLS.sha256) {
    throw new Error(
      `${jar} has SHA-256 ${found}, not the pinned ${TLA_TOOLS.sha256}. ` +
        'It is not the jar this checkout pins: delete it to download it again, or fix the pin in packages/devctl/src/tlc.ts.',
    );
  }
  return jar;
}

type Spec = { dir: string; module: string };

async function specs(root: string): Promise<Spec[]> {
  const found: Spec[] = [];
  const dirs = await readdir(join(root, SPECS), { withFileTypes: true });
  for (const dir of dirs.filter((d) => d.isDirectory())) {
    const files = await readdir(join(root, SPECS, dir.name));
    for (const cfg of files.filter((f) => f.endsWith('.cfg'))) {
      const module = basename(cfg, '.cfg');
      if (!files.includes(`${module}.tla`)) {
        throw new Error(`${join(SPECS, dir.name, cfg)} has no ${module}.tla beside it`);
      }
      found.push({ dir: join(SPECS, dir.name), module });
    }
  }
  return found;
}

/**
 * What is wrong with one run of TLC, from what it printed. "No error has been
 * found" is also what a run that explored nothing prints, so completion, an
 * empty queue, and more states than the initial ones are each read, after
 * eal's devctl verify.
 */
export function problems(output: string, code: number): string[] {
  const found: string[] = [];
  const violated = /Invariant (\w+) is violated/.exec(output)?.[1];
  if (violated !== undefined) {
    found.push(`invariant ${violated} is violated`);
  }
  if (code !== 0) {
    found.push(`TLC exited ${code}`);
  }
  if (!output.includes('Model checking completed. No error has been found.')) {
    found.push('TLC did not print "Model checking completed. No error has been found."');
  }
  const initial = Number(/Finished computing initial states: (\d+) distinct state/.exec(output)?.[1] ?? 0);
  const summary = /(\d+) states generated, (\d+) distinct states found, (\d+) states left on queue/.exec(output);
  if (summary === null) {
    found.push('TLC printed no summary line');
  } else {
    const [, , distinct, queued] = summary.map(Number);
    if (queued !== 0) {
      found.push(`${queued} states left on queue: the model was not explored to its end`);
    }
    if ((distinct ?? 0) <= initial) {
      found.push(`${distinct} distinct states against ${initial} initial: no step was taken`);
    }
  }
  return found;
}

export const tlc: Command = {
  name: 'tlc',
  summary: 'Model-check each hand-written TLA+ spec with TLC',
  args: '',
  help: `
Model-check each hand-written TLA+ spec (S4) with TLC: every
specs/tla/<dir>/<Module>.cfg, with the <Module>.tla beside it. Fails on a
violated invariant, a deadlock, a run that did not complete, a queue left
unexplored, and a run that took no step past the initial states.

TLC is tla2tools.jar ${TLA_TOOLS.version}, pinned by its SHA-256; it is downloaded
into .devctl/tools/ on the first run and its hash is checked on every run.
It runs in Docker, on Java from ${JAVA_IMAGE.split('@')[0]} pinned by digest. Docker
must be running.

The TLA+ that polly verify generates is checked by devctl verify, not here.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl tlc takes no arguments');
      return 1;
    }
    if (!(await dockerAnswers(root))) {
      console.error(dockerDown('tlc'));
      return 1;
    }
    const jar = await tlaTools(root);
    const all = await specs(root);
    if (all.length === 0) {
      console.error(`No spec under ${SPECS}/: a run that checks nothing is not green.`);
      return 1;
    }
    let failed = 0;
    for (const spec of all) {
      const tlcRun = await run(
        [
          'docker', 'run', '--rm',
          '-v', `${jar}:/opt/tla2tools.jar:ro`,
          '-v', `${join(root, spec.dir)}:/work:ro`,
          '-w', '/work',
          JAVA_IMAGE,
          'java', '-XX:+UseParallelGC', '-cp', '/opt/tla2tools.jar', 'tlc2.TLC',
          '-workers', 'auto', '-cleanup', '-metadir', '/tmp/states',
          '-config', `${spec.module}.cfg`, `${spec.module}.tla`,
        ],
        root,
      );
      const found = problems(tlcRun.output, tlcRun.code);
      const summary = /(\d+) distinct states found/.exec(tlcRun.output)?.[1] ?? '?';
      if (found.length === 0) {
        console.log(`ok    ${spec.module}  ${summary} distinct states, 0 left on queue  ${seconds(tlcRun.ms)}`);
      } else {
        failed++;
        console.log(`FAIL  ${spec.module}  ${seconds(tlcRun.ms)}`);
        console.log(tlcRun.output.trimEnd());
        for (const problem of found) {
          console.log(`  - ${problem}`);
        }
      }
    }
    return failed === 0 ? 0 : 1;
  },
};

