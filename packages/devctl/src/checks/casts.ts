import type { TypeNode } from 'typescript/ast';
import { isAsExpression, isIdentifier, isTypeAssertion, isTypeReferenceNode } from 'typescript/ast/is';
import { type Finding, finding, type Parsed, walk } from './syntax.ts';

/** `const`, as in `as const` and `<const>`. */
function isConst(type: TypeNode): boolean {
  return isTypeReferenceNode(type) && isIdentifier(type.typeName) && type.typeName.text === 'const';
}

/**
 * Every type assertion in one file: each `value as T` and each `<T>value`.
 * `as const` and `<const>` are not reported: the compiler checks them. The
 * file is parsed, not scanned, so a string, a regex, a comment, an import
 * alias or the `as` of a mapped type is never taken for a cast.
 */
export function findCasts(parsed: Parsed): Finding[] {
  const found: Finding[] = [];
  walk(parsed.source, (node) => {
    if ((isAsExpression(node) || isTypeAssertion(node)) && !isConst(node.type)) {
      found.push(finding(parsed, node, 'type assertion'));
    }
  });
  return found;
}
