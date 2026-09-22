/**
 * The status of the server's database, read on the server (C5): `bun
 * packages/server/src/status.ts`, inside the image. It prints one JSON line
 * with the latest migration, the database path, the marker and the replica's
 * age in seconds (S7a), and exits 1 when the database is not set up, when the
 * replica holds nothing, or when the replica is older than one hour. At 0b no
 * member exists, so this command is the way to read it.
 *
 * The replica's age comes from `litestream ltx -json -level all <url>`, the
 * binary in the image. `devctl restore` runs this command against a restored
 * database to read its marker and its latest migration (S7).
 */
import { Database } from 'bun:sqlite';
import { readStatusConfig } from './config.ts';
import { environment } from './environment.ts';
import { readMeta } from './migrations/index.ts';
import { MAX_REPLICA_AGE_SECONDS, replicaAgeSeconds, replicaVerdict } from './replica.ts';

const config = readStatusConfig(environment());

const database = new Database(config.databasePath, { readonly: true });
const meta = readMeta(database);
database.close();

const ltx = Bun.spawn(['litestream', 'ltx', '-json', '-level', 'all', config.replicaUrl], {
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
});
const [listing, errors, code] = await Promise.all([
  new Response(ltx.stdout).text(),
  new Response(ltx.stderr).text(),
  ltx.exited,
]);
if (code !== 0) {
  console.error(`litestream ltx ${config.replicaUrl} exited ${code}:\n${errors.trim()}`);
  process.exit(1);
}
const replicaAge = replicaAgeSeconds(listing, new Date());

console.log(
  JSON.stringify({
    migration: meta?.migration ?? null,
    databasePath: config.databasePath,
    marker: meta?.marker ?? null,
    replicaAgeSeconds: replicaAge ?? null,
  }),
);

const problems = [
  meta === undefined ? `The database ${config.databasePath} has no meta table: it was never set up.` : null,
  replicaVerdict(replicaAge, MAX_REPLICA_AGE_SECONDS),
].filter((problem) => problem !== null);
for (const problem of problems) {
  console.error(problem);
}
process.exit(problems.length === 0 ? 0 : 1);
