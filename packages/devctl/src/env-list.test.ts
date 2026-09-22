import { describe, expect, test } from 'bun:test';
import { compareVariables, documentedVariables, processEnvIn, shellVariablesIn } from './env-list.ts';

describe('the variables a TypeScript file reads', () => {
  test('process.env.NAME, once each, in order of name', () => {
    expect(processEnvIn('const b = process.env.FAIRFOX_B;\nconst a = process.env.FAIRFOX_A ?? process.env.FAIRFOX_B;')).toStrictEqual([
      'FAIRFOX_A',
      'FAIRFOX_B',
    ]);
  });

  test("process.env['NAME'] too", () => {
    expect(processEnvIn("process.env['FAIRFOX_C']; process.env[ 'FAIRFOX_D' ]")).toStrictEqual(['FAIRFOX_C', 'FAIRFOX_D']);
  });

  test('process.env handed on whole names nothing', () => {
    expect(processEnvIn('return process.env;')).toStrictEqual([]);
  });

  test('a file that reads none', () => {
    expect(processEnvIn('')).toStrictEqual([]);
  });
});

describe('the variables a shell script reads', () => {
  test('$FAIRFOX_X and ${FAIRFOX_X:?...}, once each, in order of name', () => {
    expect(shellVariablesIn(': "${FAIRFOX_B:?unset}"\nexec x "$FAIRFOX_A" "$FAIRFOX_B"')).toStrictEqual(['FAIRFOX_A', 'FAIRFOX_B']);
  });

  test('a variable of another name is not one of ours', () => {
    expect(shellVariablesIn('echo $HOME ${PATH}')).toStrictEqual([]);
  });
});

const document = `# Deploying

## Every setting the code reads (C3)

Text.

| Variable | Read by | Set where |
|---|---|---|
| \`FAIRFOX_PORT\` | main.ts | fly.toml |
| \`FAIRFOX_COMMIT\` | main.ts | devctl deploy |

## Settings Litestream reads

| Variable | Set where |
|---|---|
| \`LITESTREAM_ACCESS_KEY_ID\` | a secret |
`;

describe('the variables the document lists', () => {
  test('the first cell of each row under the heading, in order of name', () => {
    expect(documentedVariables(document, 'Every setting the code reads (C3)')).toStrictEqual(['FAIRFOX_COMMIT', 'FAIRFOX_PORT']);
  });

  test('the rows of the next heading are not read', () => {
    expect(documentedVariables(document, 'Settings Litestream reads')).toStrictEqual(['LITESTREAM_ACCESS_KEY_ID']);
  });

  test('a heading that is not there is refused', () => {
    expect(() => documentedVariables(document, 'Nothing')).toThrow('DEPLOY.md has no heading "## Nothing"');
  });

  test('a section with no table lists nothing', () => {
    expect(documentedVariables('\n## Empty\n\nText.\n', 'Empty')).toStrictEqual([]);
  });

  test('the header row is not a variable', () => {
    expect(documentedVariables('\n## H\n\n| Variable |\n|---|\n| `X` |\n', 'H')).toStrictEqual(['X']);
  });
});

describe('the two lists', () => {
  test('the same names agree', () => {
    expect(compareVariables(['A', 'B'], ['B', 'A'])).toStrictEqual({ undocumented: [], unread: [] });
  });

  test('a name read and not documented, and one documented and not read, in order of name', () => {
    expect(compareVariables(['B', 'A', 'Z'], ['A', 'Y', 'X'])).toStrictEqual({ undocumented: ['B', 'Z'], unread: ['X', 'Y'] });
  });
});
