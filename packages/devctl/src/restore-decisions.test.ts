import { describe, expect, test } from 'bun:test';
import { parseStatus, restoreProblems, type Status } from './restore-decisions.ts';

const status: Status = {
  migration: '001-meta',
  databasePath: '/data/fairfox.db',
  marker: '0c1d2e3f-0000-4000-8000-000000000000',
  replicaAgeSeconds: 3,
};
const line = JSON.stringify(status);

describe('reading the status line', () => {
  test('the JSON line is read, with the lines around it left', () => {
    expect(parseStatus(`time=... level=INFO msg=x\n${line}\n`)).toStrictEqual(status);
  });

  test('null fields are read as null', () => {
    expect(parseStatus('{"migration":null,"databasePath":"/x","marker":null,"replicaAgeSeconds":null}')).toStrictEqual({
      migration: null,
      databasePath: '/x',
      marker: null,
      replicaAgeSeconds: null,
    });
  });

  test('no JSON line is refused, and the output shown', () => {
    expect(() => parseStatus('error: x\n')).toThrow('The status command printed no JSON line:\nerror: x');
  });

  test('a JSON line that is not an object is refused', () => {
    expect(() => parseStatus('{')).toThrow();
  });

  test('a missing field is refused by name', () => {
    expect(() => parseStatus('{"migration":"001-meta","databasePath":"/x","marker":"m"}')).toThrow(
      'The status command printed no replicaAgeSeconds: {"migration":"001-meta","databasePath":"/x","marker":"m"}',
    );
  });

  test('a field of another kind is refused by name', () => {
    expect(() => parseStatus(line.replace('"replicaAgeSeconds":3', '"replicaAgeSeconds":true'))).toThrow(
      'The status command printed a replicaAgeSeconds of the wrong kind',
    );
  });

  test.each([
    ['migration', '"migration":"001-meta"', '"migration":1'],
    ['databasePath', '"databasePath":"/data/fairfox.db"', '"databasePath":null'],
    ['marker', `"marker":"${status.marker}"`, '"marker":7'],
    ['replicaAgeSeconds', '"replicaAgeSeconds":3', '"replicaAgeSeconds":"3"'],
  ])('a %s of the wrong kind is refused', (name, from, to) => {
    expect(() => parseStatus(line.replace(from, to))).toThrow(`The status command printed a ${name} of the wrong kind`);
  });
});

describe('the restored database against the live one', () => {
  test('the same marker at the latest migration is no problem', () => {
    expect(restoreProblems(status, { ...status, databasePath: '/restore/fairfox.db' }, '001-meta')).toStrictEqual([]);
  });

  test('no marker row is the problem an empty replica would show', () => {
    expect(restoreProblems(status, { ...status, marker: null }, '001-meta')).toStrictEqual([
      'The restored database holds no marker row: it is not the database that was set up (S7).',
    ]);
  });

  test('another marker is another database', () => {
    expect(restoreProblems(status, { ...status, marker: 'other' }, '001-meta')).toStrictEqual([
      `The restored database holds the marker other, and the live one ${status.marker}.`,
    ]);
  });

  test('a migration that is not the latest', () => {
    expect(restoreProblems(status, status, '002-members')).toStrictEqual([
      'The restored database is at migration 001-meta, and the latest is 002-members.',
    ]);
  });

  test('both problems at once, marker first', () => {
    expect(restoreProblems(status, { ...status, marker: null, migration: null }, '001-meta')).toStrictEqual([
      'The restored database holds no marker row: it is not the database that was set up (S7).',
      'The restored database is at migration null, and the latest is 001-meta.',
    ]);
  });
});
