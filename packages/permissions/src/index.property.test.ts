import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { entries } from './index.ts';

// Any list: kinds and actions are arbitrary strings, not permission names.
const lists = fc.dictionary(fc.string(), fc.array(fc.string()));

describe('entries', () => {
  test('a list has one entry for each of its actions', () => {
    fc.assert(
      fc.property(lists, (list) => {
        const actions = Object.values(list).reduce((n, kind) => n + kind.length, 0);
        expect(entries(list)).toHaveLength(actions);
      }),
    );
  });

  // Added after Stryker: the count alone let entries return empty entries.
  test('each entry is an action that its kind allows', () => {
    fc.assert(
      fc.property(lists, (list) => {
        for (const entry of entries(list)) {
          expect(list[entry.kind]).toContain(entry.action);
        }
      }),
    );
  });
});
