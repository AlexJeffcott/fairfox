/**
 * The age of the replica (S7a): how long ago Litestream last wrote to it,
 * read from what `litestream ltx -json -level all <url>` lists. Pure: the
 * listing and "now" are arguments, so a test sets both.
 */

/** A replica older than this fails the status command (S7a). */
export const MAX_REPLICA_AGE_SECONDS = 3600;

/** The time of one entry of the listing, in milliseconds since the epoch. */
function writtenAt(entry: unknown): number {
  const timestamp: unknown = Reflect.get(Object(entry), 'timestamp');
  if (typeof timestamp !== 'string') {
    throw new Error(`An LTX entry has no timestamp: ${JSON.stringify(entry)}`);
  }
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) {
    throw new Error(`An LTX entry has a timestamp that is not a time: ${JSON.stringify(timestamp)}`);
  }
  return at;
}

/** Seconds since the newest write to the replica, or undefined when the replica holds nothing. */
export function replicaAgeSeconds(listing: string, now: Date): number | undefined {
  const parsed: unknown = JSON.parse(listing);
  if (!Array.isArray(parsed)) {
    throw new Error(`litestream ltx did not print a list: ${listing.trim()}`);
  }
  if (parsed.length === 0) {
    return undefined;
  }
  const newest = Math.max(...parsed.map(writtenAt));
  return Math.max(0, Math.round((now.getTime() - newest) / 1000));
}

/** Why the replica fails the check, or null when it passes. */
export function replicaVerdict(ageSeconds: number | undefined, maxSeconds: number): string | null {
  if (ageSeconds === undefined) {
    return 'The replica holds nothing: Litestream has not written to it.';
  }
  if (ageSeconds > maxSeconds) {
    return `The replica is ${ageSeconds} s old, older than ${maxSeconds} s.`;
  }
  return null;
}
