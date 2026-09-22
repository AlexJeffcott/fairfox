/**
 * The decisions of `devctl rollback` (C6), as pure functions: which release
 * to go back to, and which commit it runs. The Fly calls are in fly.ts;
 * rollback.ts joins the two.
 */
import type { FirstRelease } from './deploy-decisions.ts';
import type { Release } from './releases.ts';

/** The registry `devctl deploy` pushes to, and the tag it gives the image: the commit. */
export const REGISTRY = 'registry.fly.io';

/** The commit an image reference of the new server carries, or undefined for any other tag: the old app's `deployment-*` among them. */
export function commitOfImageRef(imageRef: string, app: string): string | undefined {
  const found = new RegExp(`^${REGISTRY}/${app}:([0-9a-f]{40})$`).exec(imageRef);
  return found?.[1];
}

export type Rollback = { to: Release; commit: string } | { refused: string };

/**
 * The release to go back to: the newest complete release before the current
 * one. Refused when there is none, when it is older than the first release
 * of the new server (the app still holds the old app's releases, C6), and
 * when its image carries no commit.
 */
export function pickRollback(releases: readonly Release[], first: FirstRelease, app: string): Rollback {
  const sorted = [...releases].sort((a, b) => b.version - a.version);
  const current = sorted[0];
  if (current === undefined) {
    return { refused: `The app ${app} has no release.` };
  }
  const to = sorted.find((r) => r.version < current.version && r.status === 'complete');
  if (to === undefined) {
    return { refused: `No complete release before version ${current.version}: nothing to go back to.` };
  }
  if (to.version < first.version) {
    return {
      refused: `Version ${to.version} is older than version ${first.version}, the first release of the new server (deploy/first-release.json). It is the old app's, and the rollback refuses it (C6).`,
    };
  }
  const commit = commitOfImageRef(to.imageRef, app);
  if (commit === undefined) {
    return { refused: `Version ${to.version} runs ${to.imageRef}, whose tag is not a commit: not a release devctl deploy made.` };
  }
  return { to, commit };
}
