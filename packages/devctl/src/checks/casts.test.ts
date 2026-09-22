import { describe, expect, test } from 'bun:test';
import { findCasts } from './casts.ts';

// Each form found by the cold read of rebuild-local, or by the session, that
// eal's line scan let through.
const casts: readonly [string, string][] = [
  ['a cast of a call', 'const user = JSON.parse(raw) as User;'],
  ['an exported cast', 'export const b = a as User;'],
  ['a cast on a line that also holds as const', 'const a = b as User, c = [1] as const;'],
  ['a cast after )', 'const user = load() as User;'],
  ['a cast in an arrow', 'const f = (x: unknown) => x as Array<string>;'],
  ['a cast after a string holding a quote', 'const user = get("it\'s") as User;'],
  ['a cast after a string holding ://', "const user = get('https://example.org') as User;"],
  ['a cast alone on a line', 'const list = [\n  value as User,\n];'],
  ['a tab before as', 'const user = value\tas User;'],
  // A line break before `as` ends the statement: tsc rejects it, and the build check fails.
  ['a line break after as', 'const user = value as\n  User;'],
  ['an angle-bracket assertion', 'const user = <User>value;'],
  ['a cast in a return', 'function f(value: unknown) {\n  return value as User;\n}'],
];

const tsxCasts: readonly [string, string][] = [
  ['a cast after ? in .tsx', 'const user = ok ? value as User : other;'],
  ['a cast in a throw in .tsx', 'function f() {\n  throw value as Error;\n}'],
];

const notCasts: readonly [string, string][] = [
  ['as const', 'const pair = [1, 2] as const;'],
  ['<const>', 'const pair = <const>[1, 2];'],
  ['the as of a mapped type', 'type Upper<T> = { [K in keyof T as Uppercase<K & string>]: T[K] };'],
  ['a regex', 'const r = / as /;'],
  ['a string', "const s = 'value as User';"],
  ['a template', 'const s = `${value} as User`;'],
  ['import and export aliases', "import { a as b } from 'x';\nimport * as ns from 'y';\nexport { b as c };"],
  ['a comment', '// value as User\n/* value as User */'],
  ['satisfies', 'const user = value satisfies User;'],
];

describe('findCasts', () => {
  for (const [name, source] of casts) {
    test(`finds ${name}`, () => {
      expect(findCasts('a.ts', source)).toHaveLength(1);
    });
  }
  for (const [name, source] of tsxCasts) {
    test(`finds ${name}`, () => {
      expect(findCasts('a.tsx', source)).toHaveLength(1);
    });
  }
  for (const [name, source] of notCasts) {
    test(`leaves ${name}`, () => {
      expect(findCasts('a.ts', source)).toEqual([]);
    });
  }
  test('leaves JSX text in .tsx', () => {
    expect(findCasts('a.tsx', 'const p = <p>Signed in as guest</p>;')).toEqual([]);
  });
  test('names the line of the cast', () => {
    expect(findCasts('a.ts', 'const a = 1;\nconst b = a as User;')).toEqual([
      { file: 'a.ts', line: 2, text: 'a as User', reason: 'type assertion' },
    ]);
  });
});
