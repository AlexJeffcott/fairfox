import { describe, expect, test } from 'bun:test';
import { newest, parseReleases, type Release } from './releases.ts';

/** One entry as fly releases --json prints it, with the fields devctl does not read. */
function entry(version: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ID: `id-${version}`,
    Version: version,
    Stable: false,
    InProgress: false,
    Reason: '',
    Description: 'Release',
    Status: 'complete',
    DeploymentStrategy: '',
    Metadata: null,
    User: { ID: 'u', Name: 'Alex', Email: 'a@example.com' },
    EvaluationID: '',
    CreatedAt: `2026-09-2${version}T10:00:00Z`,
    ImageRef: `registry.fly.io/fairfox:deployment-${version}`,
    ...extra,
  };
}

describe('parsing fly releases --json', () => {
  test('each release keeps its id, version, status, time and image', () => {
    expect(parseReleases(JSON.stringify([entry(2), entry(1)]))).toStrictEqual([
      { id: 'id-2', version: 2, status: 'complete', createdAt: '2026-09-22T10:00:00Z', imageRef: 'registry.fly.io/fairfox:deployment-2' },
      { id: 'id-1', version: 1, status: 'complete', createdAt: '2026-09-21T10:00:00Z', imageRef: 'registry.fly.io/fairfox:deployment-1' },
    ]);
  });

  test('an empty list is an app with no release', () => {
    expect(parseReleases('[]')).toStrictEqual([]);
  });

  test('not a list is refused', () => {
    expect(() => parseReleases('{"Version":1}')).toThrow('fly releases --json did not print a list');
  });

  test('an entry that is not an object is refused, by its index', () => {
    expect(() => parseReleases(JSON.stringify([entry(2), 7]))).toThrow('Release 1 of fly releases --json is not an object');
  });

  test('a missing field is refused, by name', () => {
    expect(() => parseReleases(JSON.stringify([entry(1, { ImageRef: undefined })]))).toThrow('Release 0 of fly releases --json has no ImageRef');
  });

  test('a null field is refused, by name', () => {
    expect(() => parseReleases(JSON.stringify([entry(1, { ID: null })]))).toThrow('Release 0 of fly releases --json has no ID');
  });

  test('a text field that is not a string is refused', () => {
    expect(() => parseReleases(JSON.stringify([entry(1, { Status: 3 })]))).toThrow(
      'Release 0 of fly releases --json has a Status that is not a string',
    );
  });

  test.each(['"3"', '3.5'])('a version of %s is refused', (version) => {
    expect(() => parseReleases(`[${JSON.stringify(entry(1)).replace('"Version":1', `"Version":${version}`)}]`)).toThrow(
      'Release 0 of fly releases --json has a Version that is not a whole number',
    );
  });
});

describe('the newest release', () => {
  const release = (version: number): Release => ({
    id: `id-${version}`,
    version,
    status: 'complete',
    createdAt: '',
    imageRef: '',
  });

  test('is the highest version, whatever the order printed', () => {
    expect(newest([release(27), release(28), release(26)])?.version).toBe(28);
  });

  test('the list is not reordered', () => {
    const list = [release(27), release(28)];
    newest(list);
    expect(list.map((r) => r.version)).toStrictEqual([27, 28]);
  });

  test('an app with no release has none', () => {
    expect(newest([])).toBeUndefined();
  });
});
