import { describe, expect, test } from 'bun:test';
import { type DeployFacts, deployRecord, deployRefusal, firstRelease, recordFileName } from './deploy-decisions.ts';
import type { Release } from './releases.ts';

const head = '3f9c2e1f3f9c2e1f3f9c2e1f3f9c2e1f3f9c2e1f';
const checks = ['install', 'build', 'image'];
const ready: DeployFacts = {
  head,
  clean: true,
  record: { commit: head, finishedAt: '2026-09-22T10:00:00Z', green: checks },
  checks,
};

describe('may it deploy', () => {
  test('a clean tree with a green record of every check may', () => {
    expect(deployRefusal(ready)).toBeNull();
  });

  test('a tree with changes may not', () => {
    expect(deployRefusal({ ...ready, clean: false })).toBe(
      'The working tree is not clean. A deploy is of one commit and no other (M6): commit or stash, run devctl ci, then deploy.',
    );
  });

  test('a commit with no record may not', () => {
    expect(deployRefusal({ ...ready, record: undefined })).toBe(`No record of a green devctl ci run for ${head}. Run devctl ci, then deploy (M6).`);
  });

  test('a record of another commit may not', () => {
    expect(deployRefusal({ ...ready, record: { ...ready.record, commit: 'a07b5d4', finishedAt: '', green: checks } })).toBe(
      `The record for ${head} names another commit, a07b5d4. Run devctl ci, then deploy (M6).`,
    );
  });

  test('a record that lacks a check registered since may not, and the checks are named', () => {
    expect(deployRefusal({ ...ready, checks: [...checks, 'replica', 'env-list'] })).toBe(
      `The record for ${head} holds no green run of: replica, env-list. Run devctl ci, then deploy (M6).`,
    );
  });

  test('a record with more checks than are registered may', () => {
    expect(deployRefusal({ ...ready, checks: ['build'] })).toBeNull();
  });

  test('the tree is checked before the record', () => {
    expect(deployRefusal({ ...ready, clean: false, record: undefined })).toContain('not clean');
  });
});

const release = (version: number): Release => ({
  id: `id-${version}`,
  version,
  status: 'complete',
  createdAt: `2026-09-22T10:00:0${version}Z`,
  imageRef: `registry.fly.io/fairfox:${head}`,
});
const at = new Date('2026-09-22T20:15:30.123Z');

describe('the deploy record', () => {
  test('holds the release before and after, the commit, the time and the version answered', () => {
    expect(
      deployRecord({ kind: 'deploy', app: 'fairfox', commit: head, at, before: release(1), after: release(2), version: `{"commit":"${head}"}` }),
    ).toStrictEqual({
      kind: 'deploy',
      app: 'fairfox',
      commit: head,
      at: '2026-09-22T20:15:30.123Z',
      before: release(1),
      after: release(2),
      version: `{"commit":"${head}"}`,
    });
  });

  test('the first deploy of an app has no release before', () => {
    expect(deployRecord({ kind: 'deploy', app: 'fairfox', commit: head, at, before: undefined, after: release(1), version: '' }).before).toBeNull();
  });

  test('a rollback is recorded as one', () => {
    expect(deployRecord({ kind: 'rollback', app: 'fairfox', commit: head, at, before: release(2), after: release(3), version: '' }).kind).toBe(
      'rollback',
    );
  });

  test('no release after is refused', () => {
    expect(() => deployRecord({ kind: 'deploy', app: 'fairfox', commit: head, at, before: undefined, after: undefined, version: '' })).toThrow(
      'The app fairfox has no release after the deploy.',
    );
  });

  test('a release after that is not newer is refused', () => {
    expect(() => deployRecord({ kind: 'deploy', app: 'fairfox', commit: head, at, before: release(2), after: release(2), version: '' })).toThrow(
      'The deploy made no release: the newest is still version 2, and it was version 2 before.',
    );
  });

  test('a release after that is older is refused', () => {
    expect(() => deployRecord({ kind: 'rollback', app: 'fairfox', commit: head, at, before: release(3), after: release(2), version: '' })).toThrow(
      'The rollback made no release: the newest is still version 2, and it was version 3 before.',
    );
  });
});

describe('the record file', () => {
  test('is named by the time, with no colon or dot', () => {
    expect(recordFileName(at)).toBe('2026-09-22T20-15-30-123Z.json');
  });
});

describe('the first release', () => {
  test('names the app, the release and the commit', () => {
    expect(firstRelease('fairfox', release(29), head)).toStrictEqual({
      app: 'fairfox',
      version: 29,
      id: 'id-29',
      createdAt: '2026-09-22T10:00:029Z',
      commit: head,
    });
  });
});
