import { describe, expect, test } from 'bun:test';
import { strip } from '../src/strip.ts';

describe('strip', () => {
  test('exact prefix becomes root', () => {
    const req = new Request('http://x/todo');
    const out = strip(req, '/todo');
    expect(new URL(out.url).pathname).toBe('/');
  });

  test('trailing slash becomes root', () => {
    const req = new Request('http://x/todo/');
    const out = strip(req, '/todo');
    expect(new URL(out.url).pathname).toBe('/');
  });

  test('subpath with query preserved', () => {
    const req = new Request('http://x/todo/api/projects?status=active');
    const out = strip(req, '/todo');
    const u = new URL(out.url);
    expect(u.pathname).toBe('/api/projects');
    expect(u.searchParams.get('status')).toBe('active');
  });

  test('false-prefix /todoish is left untouched', () => {
    const req = new Request('http://x/todoish/y');
    const out = strip(req, '/todo');
    expect(new URL(out.url).pathname).toBe('/todoish/y');
  });

  test('method and headers preserved on rewrite', () => {
    const req = new Request('http://x/todo/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
      body: '{"tid":"T1","description":"x"}',
    });
    const out = strip(req, '/todo');
    expect(out.method).toBe('POST');
    expect(out.headers.get('x-test')).toBe('1');
    expect(out.headers.get('content-type')).toBe('application/json');
  });
});
