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
