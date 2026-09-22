import ts from 'typescript';
import { type Finding, finding, parse, walk } from './syntax.ts';

/**
 * Every type assertion in one file: each `value as T` and each `<T>value`.
 * `as const` and `<const>` are not reported: the compiler checks them. The
 * file is parsed, not scanned, so a string, a regex, a comment, an import
 * alias or the `as` of a mapped type is never taken for a cast.
 */
export function findCasts(file: string, text: string): Finding[] {
  const source = parse(file, text);
  const found: Finding[] = [];
  walk(source, (node) => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !ts.isConstTypeReference(node.type)) {
      found.push(finding(source, node, 'type assertion'));
    }
  });
  return found;
}
