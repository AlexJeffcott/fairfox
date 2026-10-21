import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { parse, parseAll } from './syntax.ts';

describe('parse', () => {
  test('keeps the file name it was given', async () => {
    expect((await parse('a.ts', 'const a = 1;')).file).toBe('a.ts');
  });
  test('parses each file of parseAll, in order', async () => {
    const parsed = await parseAll([
      { file: 'a.ts', text: 'const a = 1;' },
      { file: 'b.tsx', text: 'const b = <p />;' },
    ]);
    expect(parsed.map((p) => [p.file, p.source.statements.length])).toEqual([
      ['a.ts', 1],
      ['b.tsx', 1],
    ]);
  });
  // The parser is a separate process: one left running keeps the caller from exiting, and bun test exits regardless.
  // The time limit kills a child that does not exit, so a failed run leaves no process behind.
  test('lets the process that parsed exit', async () => {
    const script = `import { parse } from ${JSON.stringify(join(import.meta.dir, 'syntax.ts'))}; await parse('a.ts', 'const a = 1;'); console.log('parsed');`;
    const child = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'inherit', timeout: 4000 });
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe('parsed\n');
  });
});
