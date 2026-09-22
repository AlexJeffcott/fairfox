/**
 * Which migrations to run, from the name the database holds as its latest
 * and the names this image knows, in order. Migrations run forward only
 * (C6): a database at a migration this image does not know is ahead of it,
 * from a newer image that was rolled back, and this image runs nothing and
 * reads the database as it is.
 */
export type Plan = { run: readonly string[] } | { ahead: string };

export function plan(applied: string | undefined, names: readonly string[]): Plan {
  if (applied === undefined) {
    return { run: names };
  }
  const at = names.indexOf(applied);
  if (at < 0) {
    return { ahead: applied };
  }
  return { run: names.slice(at + 1) };
}
