import { describe, expect, test } from 'bun:test';
import { readConfig } from './config.ts';

// answering-the-version.feature shows that a server with no commit set does
// not start. The one input it does not try is an empty value, which counts as
// not set (C1).
describe('the server settings', () => {
  test('an empty setting is not set', () => {
    expect(() => readConfig({ FAIRFOX_COMMIT: '', FAIRFOX_DATABASE_PATH: ':memory:' })).toThrow(
      'The setting FAIRFOX_COMMIT is not set',
    );
  });
});
