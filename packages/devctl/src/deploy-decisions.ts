/**
 * The decisions of `devctl deploy` (M6, M4), as pure functions: may it
 * deploy, which release is "before", what the record holds. The Fly calls
 * are in fly.ts; deploy.ts joins the two.
 */
import type { CiRecord } from './ci.ts';
import type { Release } from './releases.ts';

export type DeployFacts = {
  /** The commit at HEAD. */
  head: string;
  /** Whether git reports no change, staged, unstaged or untracked. */
  clean: boolean;
  /** The record of `devctl ci` for HEAD, or undefined when there is none. */
  record: CiRecord | undefined;
  /** The name of every check registered now. */
  checks: readonly string[];
};

/** Why the deploy is refused, or null when it may go ahead. */
export function deployRefusal(facts: DeployFacts): string | null {
  if (!facts.clean) {
    return 'The working tree is not clean. A deploy is of one commit and no other (M6): commit or stash, run devctl ci, then deploy.';
  }
  const { record } = facts;
  if (record === undefined) {
    return `No record of a green devctl ci run for ${facts.head}. Run devctl ci, then deploy (M6).`;
  }
  if (record.commit !== facts.head) {
    return `The record for ${facts.head} names another commit, ${record.commit}. Run devctl ci, then deploy (M6).`;
  }
  const missing = facts.checks.filter((name) => !record.green.includes(name));
  if (missing.length > 0) {
    return `The record for ${facts.head} holds no green run of: ${missing.join(', ')}. Run devctl ci, then deploy (M6).`;
  }
  return null;
}

/** A deploy record (M4): what ran before, what runs after, and what the app answered. */
export type DeployRecord = {
  kind: 'deploy' | 'rollback';
  app: string;
  commit: string;
  at: string;
  before: Release | null;
  after: Release;
  /** The body the version route answered once the release was live. */
  version: string;
};

/**
 * The record of a deploy that went through. The release after must be newer
 * than the one before: a deploy that made no release is not recorded as one.
 */
export function deployRecord(input: {
  kind: 'deploy' | 'rollback';
  app: string;
  commit: string;
  at: Date;
  before: Release | undefined;
  after: Release | undefined;
  version: string;
}): DeployRecord {
  if (input.after === undefined) {
    throw new Error(`The app ${input.app} has no release after the ${input.kind}.`);
  }
  if (input.before !== undefined && input.after.version <= input.before.version) {
    throw new Error(
      `The ${input.kind} made no release: the newest is still version ${input.after.version}, and it was version ${input.before.version} before.`,
    );
  }
  return {
    kind: input.kind,
    app: input.app,
    commit: input.commit,
    at: input.at.toISOString(),
    before: input.before ?? null,
    after: input.after,
    version: input.version,
  };
}

/** The file name of a deploy record: the time, safe as a file name. */
export function recordFileName(at: Date): string {
  return `${at.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** The first release of the new server (C6): committed in deploy/first-release.json after the first deploy. */
export type FirstRelease = {
  app: string;
  version: number;
  id: string;
  createdAt: string;
  commit: string;
};

export function firstRelease(app: string, release: Release, commit: string): FirstRelease {
  return { app, version: release.version, id: release.id, createdAt: release.createdAt, commit };
}
