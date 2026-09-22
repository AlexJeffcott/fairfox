import { describe, expect, test } from 'bun:test';
import { versionVerdict } from './version-answer.ts';

describe('the verdict on a version answer', () => {
  test('the commit that was meant, and nothing else, passes', () => {
    expect(versionVerdict('{"commit":"3f9c2e1"}', '3f9c2e1')).toBeNull();
  });

  test('another commit is named, with the one that was meant', () => {
    expect(versionVerdict('{"commit":"a07b5d4"}', '3f9c2e1')).toBe('the version route answered the commit a07b5d4, not 3f9c2e1');
  });

  test('a second field fails', () => {
    expect(versionVerdict('{"commit":"3f9c2e1","server":"fairfox"}', '3f9c2e1')).toBe(
      'the version route answered more than the commit, or no commit: {"commit":"3f9c2e1","server":"fairfox"}',
    );
  });

  test('no commit fails', () => {
    expect(versionVerdict('{"version":"3f9c2e1"}', '3f9c2e1')).toBe(
      'the version route answered more than the commit, or no commit: {"version":"3f9c2e1"}',
    );
  });

  test('a commit that is not a string fails', () => {
    expect(versionVerdict('{"commit":7}', '7')).toBe('the version route answered more than the commit, or no commit: {"commit":7}');
  });

  test('a list fails', () => {
    expect(versionVerdict('["3f9c2e1"]', '3f9c2e1')).toBe('the version route did not answer an object: ["3f9c2e1"]');
  });

  test('null fails', () => {
    expect(versionVerdict('null', '3f9c2e1')).toBe('the version route did not answer an object: null');
  });

  test('a string fails', () => {
    expect(versionVerdict('"3f9c2e1"', '3f9c2e1')).toBe('the version route did not answer an object: "3f9c2e1"');
  });

  test('a body that is not JSON fails, and is shown', () => {
    expect(versionVerdict('<html>', '3f9c2e1')).toBe('the version route did not answer JSON: "<html>"');
  });
});
