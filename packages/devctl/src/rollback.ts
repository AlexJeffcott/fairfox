import type { Command } from './command.ts';
import { deployRecord } from './deploy-decisions.ts';
import { FIRST_RELEASE, readFirstRelease, writeDeployRecord } from './deploy.ts';
import { APP, flyDeploy, flyReleases, liveVersion, ORIGIN } from './fly.ts';
import { newest } from './releases.ts';
import { pickRollback } from './rollback-decisions.ts';
import { versionVerdict } from './version-answer.ts';

export const rollback: Command = {
  name: 'rollback',
  summary: 'Go back to the release before the current one on the Fly app, and record it',
  args: '',
  help: `
Rollback (C6): one command, not a CI check. Lists the releases of the Fly
app ${APP} with fly releases --json, picks the newest complete release
before the current one, and deploys its image again: flyctl has no
rollback of its own, so fly deploy --image <that image> is the rollback,
with --env FAIRFOX_COMMIT set to the commit the image's tag carries.

Refuses any release older than the one in ${FIRST_RELEASE}, the first
release of the new server: the app still holds the old app's releases,
and none of them is a Fairfox to go back to. Refuses a release whose image
tag is not a commit, for the same reason. Then reads ${ORIGIN}/version
and fails unless it answers that commit (C5), and writes
.devctl/deploys/<time>.json with the release before and after (M4).

Migrations run forward only, so the earlier image reads the database the
later one left (C6). A migration that breaks that is its own step, and its
record says the step has no rollback.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl rollback takes no arguments');
      return 1;
    }
    const first = await readFirstRelease(root);
    if (first === undefined) {
      console.error(`No ${FIRST_RELEASE}: the new server has not been deployed, so there is no release to go back to. Run devctl deploy first.`);
      return 1;
    }
    const releases = await flyReleases(root);
    const picked = pickRollback(releases, first, APP);
    if ('refused' in picked) {
      console.error(picked.refused);
      return 1;
    }
    const before = newest(releases);
    console.log(`Going back from release ${before?.version} to release ${picked.to.version}, ${picked.to.imageRef}, commit ${picked.commit}.`);
    const deployed = await flyDeploy(root, picked.to.imageRef, picked.commit);
    if (deployed !== 0) {
      console.error(`fly deploy failed (exit ${deployed}). Check fly releases and ${ORIGIN}/version.`);
      return deployed;
    }
    const version = await liveVersion();
    const verdict = versionVerdict(version, picked.commit);
    if (verdict !== null) {
      console.error(`After the rollback, ${verdict}.`);
      return 1;
    }
    const after = newest(await flyReleases(root));
    const record = deployRecord({ kind: 'rollback', app: APP, commit: picked.commit, at: new Date(), before, after, version });
    const path = await writeDeployRecord(root, record);
    console.log(`Rolled back to ${picked.commit} as release ${record.after.version} of ${APP}; it answers ${version.trim()}. Record: ${path}`);
    return 0;
  },
};
