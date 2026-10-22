import { API } from 'typescript/async';
import type { Node, SourceFile } from 'typescript/ast';

/** One place in a file where the code does something a check bans. `text` is the node's whole text. */
export type Finding = { file: string; line: number; text: string; reason: string };

/** One file and its syntax tree. `file` is the name as given: the tree's own name is made absolute. */
export type Parsed = { file: string; source: SourceFile };

/** Parse one file with an API that is open: TypeScript, or TSX when its name ends in .tsx. */
async function parseWith(api: API, file: string, text: string): Promise<Parsed> {
  await using retained = await api.createSourceFile(file, text);
  return { file, source: retained.sourceFile };
}

/**
 * Parse each file with TypeScript 7's parser, a separate process, started
 * once for all of them. `await using` stops it before this returns, because
 * one left running keeps the caller from exiting. The trees stay usable after
 * it stops.
 */
export async function parseAll(files: readonly { file: string; text: string }[]): Promise<Parsed[]> {
  await using api = new API();
  const parsed: Parsed[] = [];
  for (const { file, text } of files) {
    parsed.push(await parseWith(api, file, text));
  }
  return parsed;
}

/** Parse one file: see parseAll. */
export async function parse(file: string, text: string): Promise<Parsed> {
  await using api = new API();
  return await parseWith(api, file, text);
}

/** Call `visit` on `node` and every node inside it, depth first. */
export function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

export function finding({ file, source }: Parsed, node: Node, reason: string): Finding {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file, line: line + 1, text: node.getText(source), reason };
}
