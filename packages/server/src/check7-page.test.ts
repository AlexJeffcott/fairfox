import { describe, expect, test } from 'bun:test';
import { CHECK7_WORKER, check7Page } from './check7-page.ts';

// The page's script and the worker are strings inside template literals, so
// an escape the literal eats breaks them and no type check sees it (the check
// 3 page, 2026-09-26).
describe('the check 7 page', () => {
  test('its inline script parses', () => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(check7Page('key'))?.[1] ?? '';
    expect(script.length).toBeGreaterThan(0);
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(script)).not.toThrow();
  });
  test('the service worker parses', () => {
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(CHECK7_WORKER)).not.toThrow();
  });
});
