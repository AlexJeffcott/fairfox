import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LATEST_MIGRATION } from '../../server/src/migrations/index.ts';
import type { Command } from './command.ts';
import { buildImage, serveInImage } from './image.ts';
import { readStatus, restoreFrom } from './restore.ts';
import { restoreProblems, type Status } from './restore-decisions.ts';

/** The line Litestream prints once the first snapshot of a new database is in the replica. */
export const SNAPSHOT_WRITTEN = 'snapshot complete';

/** The line Litestream prints once it has restored a database onto a volume that held none (`tigris` TG2). */
export const RESTORED_ON_BOOT = 'restore completed';

/** The replica's directory on the host, mounted into the container. */
const REPLICA_MOUNT = '/replica';

/**
 * Make a replica: run the image with a file replica on a temporary
 * directory, wait for the server to listen and for Litestream's first
 * snapshot, read the version route, and stop. Returns the directory that
 * holds `data/` (the database) and `replica/`, and the status the server
 * reported for the live database.
 */
export async function makeReplica(root: string, tag: string, commit: string): Promise<{ dir: string; live: Status }> {
  const dir = await mkdtemp(join(tmpdir(), 'fairfox-replica-'));
  await mkdir(join(dir, 'data'));
  await mkdir(join(dir, 'replica'));
  await serveWith(root, tag, commit, dir, [SNAPSHOT_WRITTEN]);
  const live = await readStatus(root, tag, join(dir, 'data'), 'fairfox.db', join(dir, 'replica'));
  return { dir, live };
}

/** Run the image with `dir`'s `data/` at /data and `replica/` at the replica mount, and wait for `lines`. */
async function serveWith(root: string, tag: string, commit: string, dir: string, lines: readonly string[]): Promise<void> {
  const served = await serveInImage(
    root,
    tag,
    commit,
    `file://${REPLICA_MOUNT}`,
    ['-v', `${join(dir, 'data')}:/data`, '-v', `${join(dir, 'replica')}:${REPLICA_MOUNT}`],
    lines,
  );
  if (served.problem !== null) {
    throw new Error(`${served.output.trimEnd()}\n\n${served.problem}`);
  }
}

/**
 * Boot again on an empty volume (`tigris` TG2): the database directory is
 * emptied and the image is started once more against the same replica.
 * Litestream must restore the database before the server starts, and the
 * status read afterwards must be the live database's, marker and all.
 */
export async function bootOnEmptyVolume(root: string, tag: string, commit: string, dir: string): Promise<Status> {
  await rm(join(dir, 'data'), { recursive: true, force: true });
  await mkdir(join(dir, 'data'));
  await serveWith(root, tag, commit, dir, [RESTORED_ON_BOOT]);
  return readStatus(root, tag, join(dir, 'data'), 'fairfox.db', join(dir, 'replica'));
}

export const replica: Command = {
  name: 'replica',
  summary: 'Replicate the database from the image with Litestream, restore the replica, and read it back',
  args: '',
  help: `
The Litestream pipeline, end to end, on this machine (S7, S7a). The image
devctl image built, fairfox:<commit>, is started the way Fly runs it, with
its database on a temporary directory mounted at /data and a file replica
on another, mounted at ${REPLICA_MOUNT}. The command waits for the server to
listen and for Litestream's first snapshot, reads /version, and stops the
container. Then devctl restore restores that replica into a throwaway
directory and reads the restored database's marker row and latest
migration, on the server's own status command inside the image.

Then the image is started a third time, on an emptied /data against the
same replica: Litestream restores the database before the server starts
(the flag -restore-if-db-not-exists in serve.sh, tigris TG2), and the
status read afterwards must be the live database's, marker and all. A
fresh database in its place is the defect this catches: a machine that
came up on an empty volume and lost every row.

Fails when the restored marker is not the live database's, when the
restored database is not at the latest migration, ${LATEST_MIGRATION}, or
when the status command says the replica is older than one hour. An empty
replica restores nothing, and fails (M3). The temporary directories are
removed either way. The image is built first, as devctl image builds it;
an unchanged tree builds from Docker's cache in seconds. Docker must be
running.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl replica takes no arguments');
      return 1;
    }
    const { commit, tag, code: built } = await buildImage(root);
    if (built !== 0) {
      return built;
    }
    let dir: string | undefined;
    try {
      const made = await makeReplica(root, tag, commit);
      dir = made.dir;
      console.log(`Live: ${JSON.stringify(made.live)}`);
      const restored = await restoreFrom(root, tag, join(dir, 'replica'));
      console.log(`Restored: ${JSON.stringify(restored)}`);
      const problems = restoreProblems(made.live, restored, LATEST_MIGRATION);
      if (problems.length > 0) {
        console.error(problems.join('\n'));
        return 1;
      }
      const rebooted = await bootOnEmptyVolume(root, tag, commit, dir);
      console.log(`After a boot on an empty volume: ${JSON.stringify(rebooted)}`);
      const rebootProblems = restoreProblems(made.live, rebooted, LATEST_MIGRATION);
      if (rebootProblems.length > 0) {
        console.error(`On an empty volume the database was not restored before the server started.\n${rebootProblems.join('\n')}`);
        return 1;
      }
      console.log(
        `Replicated to ${join(dir, 'replica')} and restored: the marker ${restored.marker} and the migration ${restored.migration} came back, the replica was ${restored.replicaAgeSeconds} s old.`,
      );
      return 0;
    } finally {
      if (dir !== undefined) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },
};
