import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CHECKS } from './checks.ts';
import { type CiRecord, recordPath } from './ci.ts';
import type { Command } from './command.ts';
import { type DeployRecord, deployRecord, deployRefusal, type FirstRelease, firstRelease, recordFileName } from './deploy-decisions.ts';
import { APP, flyDeploy, flyReleases, liveVersion, ORIGIN, pushImage } from './fly.ts';
import { newest } from './releases.ts';
import { head, isClean } from './repo.ts';
import { REGISTRY } from './rollback-decisions.ts';
import { versionVerdict } from './version-answer.ts';

/** The first release of the new server, committed after the first deploy (C6). */
export const FIRST_RELEASE = join('deploy', 'first-release.json');

/** The record of the ci run for `commit`, or undefined when there is none. */
async function readCiRecord(root: string, commit: string): Promise<CiRecord | undefined> {
  const file = Bun.file(recordPath(root, commit));
  if (!(await file.exists())) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(await file.text());
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${recordPath(root, commit)} is not a record`);
  }
  const recorded: unknown = Reflect.get(parsed, 'commit');
  const finishedAt: unknown = Reflect.get(parsed, 'finishedAt');
  const green: unknown = Reflect.get(parsed, 'green');
  if (typeof recorded !== 'string' || typeof finishedAt !== 'string' || !Array.isArray(green)) {
    throw new Error(`${recordPath(root, commit)} is not a record`);
  }
  return { commit: recorded, finishedAt, green: green.filter((name) => typeof name === 'string') };
}

export async function readFirstRelease(root: string): Promise<FirstRelease | undefined> {
  const file = Bun.file(join(root, FIRST_RELEASE));
  if (!(await file.exists())) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(await file.text());
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${FIRST_RELEASE} is not a first release`);
  }
  const app: unknown = Reflect.get(parsed, 'app');
  const version: unknown = Reflect.get(parsed, 'version');
  const id: unknown = Reflect.get(parsed, 'id');
  const createdAt: unknown = Reflect.get(parsed, 'createdAt');
  const commit: unknown = Reflect.get(parsed, 'commit');
  if (
    typeof app !== 'string' ||
    typeof version !== 'number' ||
    typeof id !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof commit !== 'string'
  ) {
    throw new Error(`${FIRST_RELEASE} is not a first release`);
  }
  return { app, version, id, createdAt, commit };
}

/** Write a deploy record (M4) under .devctl/deploys/, and return its path. */
export async function writeDeployRecord(root: string, record: DeployRecord): Promise<string> {
  const path = join(root, '.devctl', 'deploys', recordFileName(new Date(record.at)));
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

export const deploy: Command = {
  name: 'deploy',
  summary: 'Deploy the commit at HEAD to the Fly app, and record it',
  args: '',
  help: `
Deploy the commit at HEAD to the Fly app ${APP}, and no other commit (M6).
Not a CI check: it runs when a developer runs it.

Refuses when the working tree is not clean, and when .devctl/ci/<HEAD>.json
holds no green run of every registered check: run devctl ci first. Then
tags the image devctl ci built, fairfox:<HEAD>, as
${REGISTRY}/${APP}:<HEAD>, pushes it, and runs fly deploy with that
image and --env FAIRFOX_COMMIT=<HEAD> (C7, C8). fly.toml holds the rest of
the settings; the replica URL is a secret (DEPLOY.md).

Then reads ${ORIGIN}/version and fails unless it answers HEAD and
nothing else (C5). Writes .devctl/deploys/<time>.json: the release before
and after, the commit and the version answered (M4). On the first deploy
it also writes ${FIRST_RELEASE}, the first release of the new
server, which devctl rollback refuses to go behind (C6): commit it.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl deploy takes no arguments');
      return 1;
    }
    const commit = await head(root);
    const refusal = deployRefusal({
      head: commit,
      clean: await isClean(root),
      record: await readCiRecord(root, commit),
      checks: CHECKS.map((c) => c.name),
    });
    if (refusal !== null) {
      console.error(refusal);
      return 1;
    }
    const before = newest(await flyReleases(root));
    const imageRef = `${REGISTRY}/${APP}:${commit}`;
    const pushed = await pushImage(root, `fairfox:${commit}`, imageRef);
    if (pushed !== 0) {
      return pushed;
    }
    const deployed = await flyDeploy(root, imageRef, commit);
    if (deployed !== 0) {
      console.error(`fly deploy failed (exit ${deployed}). ${ORIGIN} may run a release that is not ${commit}: check fly releases.`);
      return deployed;
    }
    const version = await liveVersion();
    const verdict = versionVerdict(version, commit);
    if (verdict !== null) {
      console.error(`After the deploy, ${verdict}.`);
      return 1;
    }
    const after = newest(await flyReleases(root));
    const record = deployRecord({ kind: 'deploy', app: APP, commit, at: new Date(), before, after, version });
    const path = await writeDeployRecord(root, record);
    console.log(`Deployed ${commit} as release ${record.after.version} of ${APP}; it answers ${version.trim()}. Record: ${path}`);
    if ((await readFirstRelease(root)) === undefined) {
      const first = firstRelease(APP, record.after, commit);
      await mkdir(dirname(join(root, FIRST_RELEASE)), { recursive: true });
      await Bun.write(join(root, FIRST_RELEASE), `${JSON.stringify(first, null, 2)}\n`);
      console.log(`The first release of the new server is ${first.version}: written to ${FIRST_RELEASE}. Commit it.`);
    }
    return 0;
  },
};
