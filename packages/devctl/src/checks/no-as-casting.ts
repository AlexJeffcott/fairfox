// Check "no-as-casting": no `as` type assertion in any TypeScript file of the
// tree. The defect it names: a value whose type the code asserts and the
// compiler never checks. Narrow with a type guard instead.
//
// Carried over from eal's scripts/check-no-as-casting.ts. Its line rules are
// eal's, with one narrowed: the rule for JSX text (see below). Allowed:
// `as const`, import and export aliases, SQL `) as alias`, JSX text.
// `as unknown as` is not an escape hatch.
import { join } from 'node:path';
import { repoRoot } from '../repo.ts';
import { typeScriptFiles } from './sources.ts';

type Violation = { file: string; line: number; content: string };

/** Lines inside a template literal or a block comment, which the scan skips. */
function computeTemplateMask(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let inTemplate = false;
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    if (inTemplate || inBlockComment) {
      mask[i] = true;
    }
    const line = lines[i] ?? '';
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      const next = line[j + 1];
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          j += 2;
          continue;
        }
      } else if (inTemplate) {
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '`') {
          inTemplate = false;
        }
      } else {
        if (ch === '/' && next === '*') {
          inBlockComment = true;
          j += 2;
          continue;
        }
        if (ch === '/' && next === '/') {
          break;
        }
        if (ch === '`') {
          inTemplate = true;
        } else if (ch === "'" || ch === '"') {
          let k = j + 1;
          while (k < line.length) {
            if (line[k] === '\\') {
              k += 2;
              continue;
            }
            if (line[k] === ch) {
              break;
            }
            k += 1;
          }
          j = k;
        }
      }
      j += 1;
    }
  }
  return mask;
}

function scan(file: string, content: string): Violation[] {
  const found: Violation[] = [];
  const lines = content.split('\n');
  const templateMask = computeTemplateMask(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (templateMask[i]) continue;

    const start = line.trim();
    if (start.startsWith('//') || start.startsWith('*') || start.startsWith('/*')) continue;

    if (!line.includes(' as ')) continue;

    const commentIndex = line.indexOf('//');
    const asIndex = line.indexOf(' as ');
    if (commentIndex !== -1 && commentIndex < asIndex) continue;

    if (line.includes(' as const')) continue;

    if (line.match(/\bas\s*[=:,]/)) continue;
    if (line.match(/\)\s+as\s+\w+/)) continue;

    if (
      line.match(/\b(import|export)\s+.*\s+as\s+\w+/) ||
      line.match(/\b(import|export)\s+\*\s+as\s+\w+/) ||
      line.match(/\b(import|export)\s+type\s+.*\s+as\s+\w+/) ||
      line.match(/^\s*\w+\s+as\s+\w+,\s*$/)
    ) {
      continue;
    }

    const beforeAs = line.substring(0, asIndex);
    const singleQuotes = (beforeAs.match(/'/g) ?? []).length;
    const doubleQuotes = (beforeAs.match(/"/g) ?? []).length;
    const backticks = (beforeAs.match(/`/g) ?? []).length;
    if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1 || backticks % 2 === 1) continue;

    const lastOpenBracket = beforeAs.lastIndexOf('>');
    const nextCloseBracket = line.indexOf('<', asIndex);
    if (lastOpenBracket !== -1 && nextCloseBracket !== -1) {
      const betweenBrackets = line.substring(lastOpenBracket + 1, nextCloseBracket);
      if (
        !betweenBrackets.includes('{') &&
        !betweenBrackets.includes('}') &&
        !betweenBrackets.includes('"') &&
        !betweenBrackets.includes("'") &&
        !betweenBrackets.includes('`')
      ) {
        continue;
      }
    }

    // JSX text, such as `Signed in as guest`. eal applied this rule to every
    // file, so it also let `return value as T;` and a bare `value as T` line
    // through. Here it holds in .tsx files only, and never for a return.
    const trimmed = line.trim();
    if (
      file.endsWith('.tsx') &&
      !/^\s*return\b/.test(beforeAs) &&
      trimmed === line.substring(line.indexOf(trimmed)) &&
      !beforeAs.includes('=') &&
      !beforeAs.includes('{') &&
      !beforeAs.includes('}') &&
      !beforeAs.includes(':') &&
      !beforeAs.includes(';') &&
      !beforeAs.includes('(') &&
      !line.startsWith('//') &&
      !line.startsWith('/*') &&
      !line.includes('const ') &&
      !line.includes('let ') &&
      !line.includes('var ')
    ) {
      continue;
    }

    found.push({ file, line: i + 1, content: trimmed });
  }
  return found;
}

const root = await repoRoot();
const files = await typeScriptFiles(root);
const violations: Violation[] = [];
for (const file of files) {
  violations.push(...scan(file, await Bun.file(join(root, file)).text()));
}

if (violations.length > 0) {
  console.log(`Found ${violations.length} forbidden 'as' type assertion(s):`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  ${v.content.slice(0, 120)}`);
  }
  process.exit(1);
}
console.log(`No 'as' type assertion in ${files.length} TypeScript files.`);
