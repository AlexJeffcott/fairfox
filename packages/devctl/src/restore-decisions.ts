/**
 * What `devctl restore` and `devctl replica` decide on (S7): the status the
 * server's command prints for a database, and whether a restored database
 * is the one that was set up. Pure; the Docker runs are in restore.ts.
 */

/** What the server's status command prints (C5): one JSON line. */
export type Status = {
  migration: string | null;
  databasePath: string;
  marker: string | null;
  replicaAgeSeconds: number | null;
};

function field(status: unknown, name: string, line: string): string | number | null {
  const value: unknown = Reflect.get(Object(status), name);
  if (value === undefined) {
    throw new Error(`The status command printed no ${name}: ${line}`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  throw new Error(`The status command printed a ${name} of the wrong kind: ${line}`);
}

/** Read the one JSON line the status command prints, among Litestream's own lines. Refuses anything else. */
export function parseStatus(output: string): Status {
  const line = output.split('\n').find((l) => l.startsWith('{'));
  if (line === undefined) {
    throw new Error(`The status command printed no JSON line:\n${output.trim()}`);
  }
  // A line that starts with { is an object, or JSON.parse refuses it.
  const parsed: unknown = JSON.parse(line);
  const migration = field(parsed, 'migration', line);
  const databasePath = field(parsed, 'databasePath', line);
  const marker = field(parsed, 'marker', line);
  const replicaAgeSeconds = field(parsed, 'replicaAgeSeconds', line);
  if (typeof migration === 'number') {
    throw new Error(`The status command printed a migration of the wrong kind: ${line}`);
  }
  if (typeof databasePath !== 'string') {
    throw new Error(`The status command printed a databasePath of the wrong kind: ${line}`);
  }
  if (typeof marker === 'number') {
    throw new Error(`The status command printed a marker of the wrong kind: ${line}`);
  }
  if (typeof replicaAgeSeconds === 'string') {
    throw new Error(`The status command printed a replicaAgeSeconds of the wrong kind: ${line}`);
  }
  return { migration, databasePath, marker, replicaAgeSeconds };
}

/** Why the restored database is not the live one at the latest migration, or nothing. */
export function restoreProblems(live: Status, restored: Status, latestMigration: string | undefined): string[] {
  const problems: string[] = [];
  if (restored.marker === null) {
    problems.push('The restored database holds no marker row: it is not the database that was set up (S7).');
  } else if (restored.marker !== live.marker) {
    problems.push(`The restored database holds the marker ${restored.marker}, and the live one ${live.marker}.`);
  }
  if (restored.migration !== latestMigration) {
    problems.push(`The restored database is at migration ${restored.migration}, and the latest is ${latestMigration}.`);
  }
  return problems;
}
