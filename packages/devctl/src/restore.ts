import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from './command.ts';
import { buildImage, FLY_PLATFORM } from './image.ts';
import { run } from './proc.ts';
import { parseStatus, type Status } from './restore-decisions.ts';

/**
 * Run the server's status command inside the image against a database in
 * `dataDir` (a directory on this machine, mounted at /data) and a replica in
 * `replicaDir` (mounted at /replica). Fails when it exits non-zero: no meta
 * table, no replica, or a replica older than one hour (S7a).
 */
export async function readStatus(root: string, tag: string, dataDir: string, file: string, replicaDir: string): Promise<Status> {
  const ran = await run(
    [
      'docker', 'run', '--rm', '--platform', FLY_PLATFORM,
      '-v', `${dataDir}:/data`,
      '-v', `${replicaDir}:/replica:ro`,
      '-e', `FAIRFOX_DATABASE_PATH=/data/${file}`,
      '-e', 'FAIRFOX_REPLICA_URL=file:///replica',
      '--entrypoint', 'bun',
      tag,
      'packages/server/src/status.ts',
    ],
    root,
  );
  if (ran.code !== 0) {
    throw new Error(`The status command in ${tag} failed (exit ${ran.code}) on /data/${file}:\n${ran.output.trim()}`);
  }
  return parseStatus(ran.output);
}

/**
 * Restore the replica in `replicaDir` into a throwaway directory with the
 * Litestream in the image, and read the restored database's status. The
 * directory is removed either way.
 */
export async function restoreFrom(root: string, tag: string, replicaDir: string): Promise<Status> {
  const out = await mkdtemp(join(tmpdir(), 'fairfox-restore-'));
  try {
    const restored = await run(
      [
        'docker', 'run', '--rm', '--platform', FLY_PLATFORM,
        '-v', `${replicaDir}:/replica:ro`,
        '-v', `${out}:/restore`,
        '--entrypoint', 'litestream',
        tag,
        'restore', '-o', '/restore/fairfox.db', 'file:///replica',
      ],
      root,
    );
    if (restored.code !== 0) {
      throw new Error(`The restore from ${replicaDir} failed (exit ${restored.code}):\n${restored.output.trim()}`);
    }
    return await readStatus(root, tag, out, 'fairfox.db', replicaDir);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

export const restore: Command = {
  name: 'restore',
  summary: 'Restore a Litestream file replica into a throwaway directory and read the marker and the migration',
  args: '<replica-dir>',
  help: `
Restore from backup (S7): a Litestream file replica in <replica-dir>, a
directory on this machine, is restored with the Litestream in the image
devctl image built, fairfox:<commit>, into a throwaway directory. Then the
server's status command runs inside the image against the restored
database and prints its latest migration, its marker row and the
replica's age. The throwaway directory is removed either way.

Fails when the restore fails (an empty replica restores nothing), when the
restored database has no meta table, and when the replica is older than
one hour (S7a). devctl replica makes a replica and runs this on it. A
replica in a bucket is restored to a directory first; the credentials it
needs are Litestream's, and this command does not read them. The image is
built first, as devctl image builds it. Docker must be running.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    const [dir, ...rest] = positionals;
    if (dir === undefined || rest.length > 0) {
      console.error('devctl restore takes one argument: the directory of a Litestream file replica');
      return 1;
    }
    const { tag, code: built } = await buildImage(root);
    if (built !== 0) {
      return built;
    }
    const status = await restoreFrom(root, tag, resolve(root, dir));
    console.log(JSON.stringify(status));
    console.log(`Restored from ${dir}: the marker ${status.marker}, at migration ${status.migration}; the replica is ${status.replicaAgeSeconds} s old.`);
    return 0;
  },
};
