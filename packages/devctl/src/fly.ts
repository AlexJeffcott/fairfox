import { parseReleases, type Release } from './releases.ts';
import { run } from './proc.ts';
import { stream, streamEach } from './stream.ts';

/** The Fly app (C10): the one that exists, so the new server takes its address. */
export const APP = 'fairfox';
/** Where the app answers. */
export const ORIGIN = 'https://fairfox.fly.dev';

/**
 * The calls to Fly and to the registry, each one thin: no decision is made
 * here. The decisions are in deploy-decisions.ts and rollback-decisions.ts,
 * with their tests. None of these runs in CI.
 */

/** Every release of the app, as Fly lists them. */
export async function flyReleases(root: string): Promise<Release[]> {
  const listed = await run(['fly', 'releases', '-a', APP, '--json'], root);
  if (listed.code !== 0) {
    throw new Error(`fly releases failed (exit ${listed.code}):\n${listed.output.trim()}`);
  }
  return parseReleases(listed.output);
}

/** Tag the image `devctl image` built as the registry's, and push it: the same image (C7). */
export function pushImage(root: string, localTag: string, imageRef: string): Promise<number> {
  return streamEach(
    [
      ['docker', 'tag', localTag, imageRef],
      ['fly', 'auth', 'docker'],
      ['docker', 'push', imageRef],
    ],
    root,
  );
}

/** `fly deploy` of one image, with the commit it runs set for the server (C8). */
export function flyDeploy(root: string, imageRef: string, commit: string): Promise<number> {
  return stream(
    ['fly', 'deploy', '-a', APP, '--config', 'fly.toml', '--image', imageRef, '--env', `FAIRFOX_COMMIT=${commit}`, '--yes'],
    root,
  );
}

/** The body the app's version route answers now. */
export async function liveVersion(): Promise<string> {
  const answer = await fetch(`${ORIGIN}/version`);
  const body = await answer.text();
  if (answer.status !== 200) {
    throw new Error(`${ORIGIN}/version answered ${answer.status}: ${body}`);
  }
  return body;
}
