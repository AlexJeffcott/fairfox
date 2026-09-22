import { describe, expect, test } from 'bun:test';
import type { FirstRelease } from './deploy-decisions.ts';
import type { Release } from './releases.ts';
import { commitOfImageRef, pickRollback, REGISTRY } from './rollback-decisions.ts';

const a = 'a07b5d4a07b5d4a07b5d4a07b5d4a07b5d4a07b5';
const b = '3f9c2e1f3f9c2e1f3f9c2e1f3f9c2e1f3f9c2e1f';

const release = (version: number, tag: string, status = 'complete'): Release => ({
  id: `id-${version}`,
  version,
  status,
  createdAt: '',
  imageRef: `${REGISTRY}/fairfox:${tag}`,
});
const first: FirstRelease = { app: 'fairfox', version: 29, id: 'id-29', createdAt: '', commit: a };
const old = release(28, 'deployment-01KSJKWMC1313B2047SRM5JXD7');

describe('the commit of an image reference', () => {
  test('is the tag of an image devctl deploy pushed', () => {
    expect(commitOfImageRef(`${REGISTRY}/fairfox:${a}`, 'fairfox')).toBe(a);
  });

  test("the old app's deployment tag is no commit", () => {
    expect(commitOfImageRef(old.imageRef, 'fairfox')).toBeUndefined();
  });

  test('a short commit is no commit', () => {
    expect(commitOfImageRef(`${REGISTRY}/fairfox:3f9c2e1`, 'fairfox')).toBeUndefined();
  });

  test("another app's image is no commit of this one", () => {
    expect(commitOfImageRef(`${REGISTRY}/fairfox-turn:${a}`, 'fairfox')).toBeUndefined();
  });

  test('another registry is refused', () => {
    expect(commitOfImageRef(`docker.io/fairfox:${a}`, 'fairfox')).toBeUndefined();
  });
});

describe('which release to go back to', () => {
  test('the newest complete release before the current one, whatever the order listed', () => {
    expect(pickRollback([release(29, a), release(30, b), old], first, 'fairfox')).toStrictEqual({ to: release(29, a), commit: a });
  });

  test('a release that is not complete is skipped', () => {
    expect(pickRollback([release(31, b), release(30, b, 'failed'), release(29, a)], first, 'fairfox')).toStrictEqual({
      to: release(29, a),
      commit: a,
    });
  });

  test('an app with no release is refused', () => {
    expect(pickRollback([], first, 'fairfox')).toStrictEqual({ refused: 'The app fairfox has no release.' });
  });

  test('a current release with none before it is refused', () => {
    expect(pickRollback([release(29, a)], first, 'fairfox')).toStrictEqual({
      refused: 'No complete release before version 29: nothing to go back to.',
    });
  });

  test("the old app's release, older than the first of the new server, is refused (C6)", () => {
    expect(pickRollback([release(29, a), old], first, 'fairfox')).toStrictEqual({
      refused:
        "Version 28 is older than version 29, the first release of the new server (deploy/first-release.json). It is the old app's, and the rollback refuses it (C6).",
    });
  });

  test('the first release itself may be gone back to', () => {
    expect(pickRollback([release(30, b), release(29, a)], first, 'fairfox')).toStrictEqual({ to: release(29, a), commit: a });
  });

  test('a release at or after the first whose image carries no commit is refused', () => {
    expect(pickRollback([release(31, b), release(30, 'deployment-01KSJKWMC1313B2047SRM5JXD7')], first, 'fairfox')).toStrictEqual({
      refused: `Version 30 runs ${REGISTRY}/fairfox:deployment-01KSJKWMC1313B2047SRM5JXD7, whose tag is not a commit: not a release devctl deploy made.`,
    });
  });
});
