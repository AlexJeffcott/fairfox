import { describe, expect, test } from 'bun:test';
import { plan } from './plan.ts';

const names = ['001-meta', '002-members', '003-sessions'];

describe('the migration plan', () => {
  test('a database with no migration runs every one, in order', () => {
    expect(plan(undefined, names)).toStrictEqual({ run: names });
  });

  test('a database at the first migration runs the ones after it', () => {
    expect(plan('001-meta', names)).toStrictEqual({ run: ['002-members', '003-sessions'] });
  });

  test('a database at the latest migration runs none', () => {
    expect(plan('003-sessions', names)).toStrictEqual({ run: [] });
  });

  test('a database at a migration this image does not know is ahead, and runs none', () => {
    expect(plan('004-calls', names)).toStrictEqual({ ahead: '004-calls' });
  });

  test('an image with no migrations runs none on an empty database', () => {
    expect(plan(undefined, [])).toStrictEqual({ run: [] });
  });
});
