import { describe, expect, test } from 'bun:test';
import { CHECK3_PAGE } from './check3-page.ts';

// The page's script is a string inside a template literal, so an escape that
// the literal eats (\' becomes ') breaks it, and no type check sees it. On
// 2026-09-26 one did, and only a browser run found it.
describe('the check 3 page', () => {
  test('its inline script parses', () => {
    const script = /<script type="module">([\s\S]*)<\/script>/.exec(CHECK3_PAGE)?.[1] ?? '';
    expect(script.length).toBeGreaterThan(0);
    expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(script)).not.toThrow();
  });
});
