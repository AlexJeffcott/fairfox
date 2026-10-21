import { API } from 'typescript/async';
import type { Node, SourceFile } from 'typescript/ast';

/** One place in a file where the code does something a check bans. `text` is the node's whole text. */
export type Finding = { file: string; line: number; text: string; reason: string };

/** One file and its syntax tree. `file` is the name as given: the tree's own name is made absolute. */
export type Parsed = { file: string; source: SourceFile };

/** Parse one file with an API that is open: TypeScript, or TSX when its name ends in .tsx. */
async function parseWith(api: API, file: string, text: string): Promise<Parsed> {
  const retained = await api.createSourceFile(file, text);
  await retained.dispose();
  return { file, source: retained.sourceFile };
}

/**
 * Run `use` with an API to TypeScript 7's parser, a separate process. The
 * process is stopped before this returns, because one left running keeps the
 * caller from exiting. The trees it parsed stay usable after it stops.
 */
async function withParser<T>(use: (api: API) => Promise<T>): Promise<T> {
  const api = new API();
  try {
    return await use(api);
  } finally {
    await api.close();
  }
}

/** Parse each file, with one parser process for all of them: see parseWith. */
export function parseAll(files: readonly { file: string; text: string }[]): Promise<Parsed[]> {
  return withParser(async (api) => {
    const parsed: Parsed[] = [];
    for (const { file, text } of files) {
      parsed.push(await parseWith(api, file, text));
    }
    return parsed;
  });
}

/** Parse one file: see parseWith. */
export function parse(file: string, text: string): Promise<Parsed> {
  return withParser((api) => parseWith(api, file, text));
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
