import ts from 'typescript';

/** One place in a file where the code does something a check bans. */
export type Finding = { file: string; line: number; text: string; reason: string };

/** Parse one file as TypeScript, or as TSX when its name ends in .tsx. */
export function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** Call `visit` on every node of the file, depth first. */
export function walk(source: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, step);
  };
  step(source);
}

export function finding(source: ts.SourceFile, node: ts.Node, reason: string): Finding {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: line + 1, text: node.getText(source).split('\n')[0] ?? '', reason };
}

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
