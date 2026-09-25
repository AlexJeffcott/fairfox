import { join } from 'node:path';
import type { Command } from './command.ts';
import { removeContainer, startContainer } from './container.ts';
import { dockerAnswers, dockerDown } from './docker.ts';
import { readFlyConfig } from './fly-config.ts';
import { IMAGE_PACKAGES, notAllowed, packagesIn, STORE } from './image-contents.ts';
import { run } from './proc.ts';
import { head, isClean } from './repo.ts';
import { stream } from './stream.ts';
import { versionVerdict } from './version-answer.ts';

/** Fly's machines run linux/amd64. The image is built for them, whatever the developer's machine is. */
export const FLY_PLATFORM = 'linux/amd64';

/** The line main.ts prints once it listens. */
export const LISTENING = 'Fairfox listening on port';

/** How long the server in the image gets to listen, under emulation. A limit, not a wait. */
export const START_LIMIT_MS = 60_000;

/** The image of the checkout: fairfox:<commit>, or fairfox:<commit>-dirty when the working tree has changes. */
export async function imageTag(root: string): Promise<{ commit: string; tag: string }> {
  const commit = await head(root);
  return { commit, tag: `fairfox:${commit}${(await isClean(root)) ? '' : '-dirty'}` };
}

/**
 * Build the image of the checkout for Fly's platform, with the build's own
 * output shown. Returns the tag and the commit, or the build's exit code.
 * Docker caches every layer, so a build of an unchanged tree takes seconds:
 * each command that runs the image builds it first, and runs the tree as it
 * is, never a leftover image.
 */
export async function buildImage(root: string): Promise<{ commit: string; tag: string; code: number }> {
  if (!(await dockerAnswers(root))) {
    throw new Error(dockerDown('image'));
  }
  const { commit, tag } = await imageTag(root);
  const code = await stream(['docker', 'build', '--progress', 'plain', '--platform', FLY_PLATFORM, '--tag', tag, '.'], root);
  return { commit, tag, code };
}

/**
 * The environment the server is started with in a container: what fly.toml
 * gives it, the commit the image was tagged with, and a replica that needs
 * no credentials, and a relay secret that opens no relay. `FAIRFOX_DATABASE_PATH` is fly.toml's, on the volume
 * mounted at /data; the caller mounts something there.
 */
export async function containerEnv(root: string, commit: string, replicaUrl: string): Promise<{ env: Record<string, string>; port: number }> {
  const fly = readFlyConfig(await Bun.file(join(root, 'fly.toml')).text());
  return {
    env: { ...fly.env, FAIRFOX_COMMIT: commit, FAIRFOX_REPLICA_URL: replicaUrl, FAIRFOX_TURN_SECRET: 'image-check' },
    port: fly.internalPort,
  };
}

/** `-e NAME=value` for each setting. */
export function envFlags(env: Readonly<Record<string, string>>): string[] {
  return Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
}

/**
 * Start the server in the image the way Fly runs it (IM1): its CMD, with
 * the settings of fly.toml, and read the version route from outside the
 * container. Returns what went wrong, or null. The container is stopped and
 * removed either way. `mounts` are further `docker run` flags, for the
 * database and the replica; `alsoWaitFor` are lines to wait for beyond the
 * server's own, before the route is read.
 */
export async function serveInImage(
  root: string,
  tag: string,
  commit: string,
  replicaUrl: string,
  mounts: readonly string[],
  alsoWaitFor: readonly string[],
): Promise<{ problem: string | null; output: string; port: number }> {
  const { env, port } = await containerEnv(root, commit, replicaUrl);
  const name = `fairfox-${tag.replace(/[^A-Za-z0-9_.-]/g, '-').replace(':', '-')}-${process.pid}`;
  const container = startContainer(
    name,
    ['--rm', '--platform', FLY_PLATFORM, ...envFlags(env), '-p', `127.0.0.1:0:${port}`, ...mounts, tag],
    root,
  );
  try {
    try {
      await container.waitFor([LISTENING, ...alsoWaitFor], START_LIMIT_MS);
    } catch (error) {
      return { problem: `The server in ${tag} did not start: ${error instanceof Error ? error.message : String(error)}`, output: container.output(), port };
    }
    const hostPort = await container.hostPort(port);
    let body: string;
    try {
      const answer = await fetch(`http://127.0.0.1:${hostPort}/version`);
      body = await answer.text();
      if (answer.status !== 200) {
        return { problem: `The version route of ${tag} answered ${answer.status}: ${body}`, output: container.output(), port };
      }
    } catch (error) {
      return {
        problem: `No answer from the server in ${tag} on port ${port} of the container: ${error instanceof Error ? error.message : String(error)}`,
        output: container.output(),
        port,
      };
    }
    const verdict = versionVerdict(body, commit);
    if (verdict !== null) {
      return { problem: `In ${tag}, ${verdict}`, output: container.output(), port };
    }
    return { problem: null, output: await container.stop(), port };
  } finally {
    await removeContainer(name, root);
  }
}

export const image: Command = {
  name: 'image',
  summary: 'Build the production image from the checkout, check what it holds, and run the server in it',
  args: '',
  help: `
Build the production image (C7) from the Dockerfile at the root, with the
checkout as its build context, the way a deploy builds it. This is the
image a deploy sends to Fly: there is one image, not two. .dockerignore
lets in the manifests, the lockfile and the packages production runs, so
no file a development tool leaves in the checkout reaches the image, and
no dependency of a package production does not run.

No development tool is in the image. They install and run on a
developer's machine only (\`devlocal\` DL1), so none of them can stop this
build. Stryker stopped eal's, from June to 2026-08-25, and nothing saw it
until a deploy (L6).

After the build, ${STORE} is listed in the image and every package in it
is looked up in IMAGE_PACKAGES, the table in image-contents.ts that says
what put each one there. The command fails on a package the table does
not name, and on a package the table names that the image does not hold.

Then the server is started in the image (IM1): the image's own command,
with the settings of fly.toml, the commit the image is tagged with, a
database on a tmpfs at /data and a file replica beside it. The command
waits for the line the server prints once it listens, inside ${START_LIMIT_MS / 1000} s, reads
/version from outside the container, and fails unless the answer is the
commit and nothing else (C5). The container is stopped either way. A
production image that builds and that the server cannot run in is the
defect this catches: a green build proved nothing when --omit=peer
dropped @sinclair/typebox.

It is built for ${FLY_PLATFORM}, the platform of Fly's machines, under
emulation on an arm64 machine, and fails when the image is for another.
It is tagged fairfox:<commit>, or fairfox:<commit>-dirty when the working
tree has changes, so no two checkouts share a tag. Pushes nothing. Docker
must be running.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl image takes no arguments');
      return 1;
    }
    const { commit, tag, code: built } = await buildImage(root);
    if (built !== 0) {
      return built;
    }
    const inspected = await run(['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', tag], root);
    const platform = inspected.output.trim();
    if (platform !== FLY_PLATFORM) {
      console.error(`The image ${tag} is for ${platform}, and Fly's machines run ${FLY_PLATFORM}.`);
      return 1;
    }
    const listed = await run(['docker', 'run', '--rm', '--platform', FLY_PLATFORM, tag, 'ls', STORE], root);
    if (listed.code !== 0) {
      console.error(`The image ${tag} does not list ${STORE}:\n${listed.output.trim()}`);
      return 1;
    }
    const held = packagesIn(listed.output);
    const { extra, missing } = notAllowed(held, IMAGE_PACKAGES);
    if (extra.length > 0) {
      console.error(`The image holds packages IMAGE_PACKAGES does not name: ${extra.join(', ')}.`);
      console.error('A development tool among them is a defect: keep it out in .dockerignore or in the Dockerfile.');
    }
    if (missing.length > 0) {
      console.error(`IMAGE_PACKAGES names packages the image does not hold: ${missing.join(', ')}.`);
    }
    if (extra.length > 0 || missing.length > 0) {
      return 1;
    }
    const served = await serveInImage(root, tag, commit, 'file:///data/replica', ['--tmpfs', '/data'], []);
    if (served.problem !== null) {
      console.error(`${served.output.trimEnd()}\n\n${served.problem}`);
      return 1;
    }
    console.log(`Built ${tag}, for ${platform}, holding ${held.length} packages and no development tool.`);
    console.log(`The server in it listened on port ${served.port} and answered the commit ${commit}.`);
    return 0;
  },
};
