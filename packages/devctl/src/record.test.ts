import { describe, expect, test } from 'bun:test';
import { recordDecision, type RunFacts } from './record.ts';

const green: RunFacts = {
  full: true,
  red: 0,
  cleanBefore: true,
  cleanAfter: true,
  headBefore: '3f9c2e1',
  headAfter: '3f9c2e1',
};

describe('the ci record', () => {
  test('a full green run of one clean commit writes it', () => {
    expect(recordDecision(green)).toBe('write');
  });

  test('a run of some checks writes none', () => {
    expect(recordDecision({ ...green, full: false })).toBe('partial');
  });

  test('a run with a red check writes none', () => {
    expect(recordDecision({ ...green, red: 1 })).toBe('red');
  });

  test('a tree with changes before the run writes none', () => {
    expect(recordDecision({ ...green, cleanBefore: false })).toBe('not-one-commit');
  });

  test('a tree changed during the run writes none', () => {
    expect(recordDecision({ ...green, cleanAfter: false })).toBe('not-one-commit');
  });

  test('a HEAD that moved during the run writes none', () => {
    expect(recordDecision({ ...green, headAfter: '8a07d4b' })).toBe('not-one-commit');
  });
});
