import { describe, expect, test } from 'bun:test';
import { IMAGE_PACKAGES, notAllowed, packageOf, packagesIn, STORE } from './image-contents.ts';

describe('the package a store directory holds', () => {
  test('an unscoped package is named without its version', () => {
    expect(packageOf('memoirist@0.4.0')).toBe('memoirist');
  });

  test('a version with a hash after it is dropped too', () => {
    expect(packageOf('elysia@1.4.30+4aedaac2516c6428')).toBe('elysia');
  });

  test("a scope's plus becomes a slash", () => {
    expect(packageOf('@sinclair+typebox@0.34.52')).toBe('@sinclair/typebox');
  });

  test('a scoped package with a hash keeps its scope and loses the hash', () => {
    expect(packageOf('@fairfox+polly@0.82.1+38dcb74f3fc74977')).toBe('@fairfox/polly');
  });

  test("Bun's link farm holds no package", () => {
    expect(packageOf('node_modules')).toBeUndefined();
  });

  test('a directory with no version holds no package', () => {
    expect(packageOf('typescript')).toBeUndefined();
  });

  test('a scope on its own holds no package: its @ is the first character', () => {
    expect(packageOf('@types')).toBeUndefined();
  });

  test('an empty name holds no package', () => {
    expect(packageOf('')).toBeUndefined();
  });
});

describe('what the store holds', () => {
  test('a listing is read line by line, in order of name', () => {
    expect(packagesIn('memoirist@0.4.0\ncookie@1.1.1\nelysia@1.4.30+4aedaac2516c6428\n')).toStrictEqual([
      'cookie',
      'elysia',
      'memoirist',
    ]);
  });

  test('the link farm and the empty last line are left out', () => {
    expect(packagesIn('node_modules\ncookie@1.1.1\n')).toStrictEqual(['cookie']);
  });

  test('a line with spaces around it is read', () => {
    expect(packagesIn('  cookie@1.1.1  \n')).toStrictEqual(['cookie']);
  });

  test('two directories of one package are named once', () => {
    expect(packagesIn('debug@4.4.3\ndebug@4.4.3+abc\n')).toStrictEqual(['debug']);
  });

  test('an empty listing holds nothing', () => {
    expect(packagesIn('')).toStrictEqual([]);
  });
});

describe('the image against the table of what it may hold', () => {
  const table = { cookie: 'elysia', elysia: 'the server' };

  test('the image that holds exactly the table agrees with it', () => {
    expect(notAllowed(['cookie', 'elysia'], table)).toStrictEqual({ extra: [], missing: [] });
  });

  test('a package the table does not name is extra, in order of name', () => {
    expect(notAllowed(['elysia', 'typescript', 'cookie', 'ts-morph'], table)).toStrictEqual({
      extra: ['ts-morph', 'typescript'],
      missing: [],
    });
  });

  test('a package the table names that the image does not hold is missing, in order of name', () => {
    expect(notAllowed([], { elysia: 'the server', cookie: 'elysia' })).toStrictEqual({
      extra: [],
      missing: ['cookie', 'elysia'],
    });
  });

  test('both directions are reported by one call', () => {
    expect(notAllowed(['typescript'], table)).toStrictEqual({ extra: ['typescript'], missing: ['cookie', 'elysia'] });
  });
});

describe('the table itself', () => {
  test('the store is read from the working directory of the image', () => {
    expect(STORE).toBe('node_modules/.bun');
  });

  test('every package named has a reason that is not empty', () => {
    expect(Object.entries(IMAGE_PACKAGES).filter(([, reason]) => reason === '')).toEqual([]);
  });

  test('no development tool is named', () => {
    const tools = ['typescript', 'ts-morph', '@stryker-mutator/api', '@types/bun', 'fast-check', '@fairfox/polly'];
    expect(tools.filter((tool) => tool in IMAGE_PACKAGES)).toEqual([]);
  });
});
