import { describe, expect, test } from 'bun:test';
import { commitOf } from './version.ts';

const refused = "The server's answer to /version is not { commit: string }";

describe('the commit in a version answer', () => {
  test('is read from { commit: string }', () => {
    expect(commitOf({ commit: '3f9c2e1' })).toBe('3f9c2e1');
  });

  test('an answer with no commit is refused', () => {
    expect(() => commitOf({ version: '1.2' })).toThrow(`${refused}: {"version":"1.2"}`);
  });

  test('a commit that is not a string is refused', () => {
    expect(() => commitOf({ commit: 3 })).toThrow(refused);
  });

  test('an answer with more than the commit is refused', () => {
    expect(() => commitOf({ commit: '3f9c2e1', database: ':memory:' })).toThrow(refused);
  });

  test('an answer that is not an object is refused', () => {
    expect(() => commitOf('3f9c2e1')).toThrow(refused);
    expect(() => commitOf('x')).toThrow(refused);
    expect(() => commitOf(null)).toThrow(refused);
  });
});
