import { describe, expect, test } from 'bun:test';
import { parseWsRole } from '../src/parseWsRole.ts';

describe('parseWsRole', () => {
  test('missing ?role defaults to phone', () => {
    expect(parseWsRole(new URL('http://x/todo/ws'))).toBe('phone');
  });

  test('?role=phone', () => {
    expect(parseWsRole(new URL('http://x/todo/ws?role=phone'))).toBe('phone');
  });

  test('?role=relay', () => {
    expect(parseWsRole(new URL('http://x/todo/ws?role=relay'))).toBe('relay');
  });

  test('?role=client', () => {
    expect(parseWsRole(new URL('http://x/todo/ws?role=client'))).toBe('client');
  });

  test('unknown role falls back to phone', () => {
    expect(parseWsRole(new URL('http://x/todo/ws?role=garbage'))).toBe('phone');
  });
});
