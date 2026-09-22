import { describe, expect, test } from 'bun:test';
import { readConfig, readPort, readStatusConfig } from './config.ts';

// answering-the-version.feature shows that a server with no commit set does
// not start. The one input it does not try is an empty value, which counts as
// not set (C1).
describe('the server settings', () => {
  test('an empty setting is not set', () => {
    expect(() => readConfig({ FAIRFOX_COMMIT: '', FAIRFOX_DATABASE_PATH: ':memory:' })).toThrow(
      'The setting FAIRFOX_COMMIT is not set',
    );
  });

  test('the commit and the database path are read', () => {
    expect(readConfig({ FAIRFOX_COMMIT: '3f9c2e1', FAIRFOX_DATABASE_PATH: '/data/fairfox.db' })).toStrictEqual({
      commit: '3f9c2e1',
      databasePath: '/data/fairfox.db',
    });
  });
});

describe('the port', () => {
  test('is read as a number', () => {
    expect(readPort({ FAIRFOX_PORT: '3000' })).toBe(3000);
  });

  test('a missing port names the setting', () => {
    expect(() => readPort({})).toThrow('The setting FAIRFOX_PORT is not set');
  });

  test.each(['0', '65536', '80a', '-1', '3000.5', ' 3000'])('%j is not a port', (value) => {
    expect(() => readPort({ FAIRFOX_PORT: value })).toThrow(
      `The setting FAIRFOX_PORT is ${JSON.stringify(value)}, not a port from 1 to 65535.`,
    );
  });

  test.each(['1', '65535'])('%j is a port', (value) => {
    expect(readPort({ FAIRFOX_PORT: value })).toBe(Number(value));
  });
});

describe('the status settings', () => {
  test('the database path and the replica URL are read', () => {
    expect(readStatusConfig({ FAIRFOX_DATABASE_PATH: '/data/fairfox.db', FAIRFOX_REPLICA_URL: 'file:///replica' })).toStrictEqual({
      databasePath: '/data/fairfox.db',
      replicaUrl: 'file:///replica',
    });
  });

  test('a missing replica URL names the setting', () => {
    expect(() => readStatusConfig({ FAIRFOX_DATABASE_PATH: '/data/fairfox.db' })).toThrow(
      'The setting FAIRFOX_REPLICA_URL is not set',
    );
  });
});
