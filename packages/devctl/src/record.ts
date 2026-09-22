/**
 * Whether `devctl ci` writes the record of its run (M6). `devctl deploy`
 * trusts the record to mean that every check ran green on one commit, so ci
 * writes it only for a full run with no red check, on a working tree that was
 * clean from start to end, with HEAD where it started.
 */

/** What ci knew about its run when the last check finished. */
export type RunFacts = {
  /** False for `devctl ci --only`: some checks ran, not all. */
  full: boolean;
  /** How many checks went red. */
  red: number;
  cleanBefore: boolean;
  cleanAfter: boolean;
  headBefore: string;
  headAfter: string;
};

/**
 * `write`: write the record. `red`: write none, and remove the commit's old
 * record. `partial` and `not-one-commit`: write none.
 */
export type RecordDecision = 'write' | 'partial' | 'red' | 'not-one-commit';

export function recordDecision(run: RunFacts): RecordDecision {
  if (!run.full) {
    return 'partial';
  }
  if (run.red > 0) {
    return 'red';
  }
  if (!run.cleanBefore || !run.cleanAfter || run.headBefore !== run.headAfter) {
    return 'not-one-commit';
  }
  return 'write';
}
