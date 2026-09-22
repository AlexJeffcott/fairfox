import ts from 'typescript';

/** One place in a file where the code does something a check bans. `text` is the node's whole text. */
export type Finding = { file: string; line: number; text: string; reason: string };

/** Parse one file as TypeScript, or as TSX when its name ends in .tsx. */
export function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, undefined, kind);
}

/** Call `visit` on `node` and every node inside it, depth first. */
export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function finding(source: ts.SourceFile, node: ts.Node, reason: string): Finding {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: line + 1, text: node.getText(source), reason };
}
