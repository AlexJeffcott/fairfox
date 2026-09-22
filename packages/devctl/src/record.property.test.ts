import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { recordDecision } from './record.ts';

// Any run: any number of red checks, a clean tree or not before and after,
// and HEAD at one of two commits before and after, so that it often moves.
const runs = fc.record({
  full: fc.boolean(),
  red: fc.nat({ max: 20 }),
  cleanBefore: fc.boolean(),
  cleanAfter: fc.boolean(),
  headBefore: fc.constantFrom('3f9c2e1', 'a07b5d4'),
  headAfter: fc.constantFrom('3f9c2e1', 'a07b5d4'),
});

describe('the ci record', () => {
  test('is written only for a full run with no red check, on one clean commit', () => {
    fc.assert(
      fc.property(runs, (run) => {
        const oneCleanCommit = run.cleanBefore && run.cleanAfter && run.headBefore === run.headAfter;
        expect(recordDecision(run) === 'write').toBe(run.full && run.red === 0 && oneCleanCommit);
      }),
      { numRuns: 1000 },
    );
  });
});
