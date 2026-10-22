import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Node } from 'typescript/ast';
import {
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isPropertyAccessExpression,
  isStringLiteral,
  isStringLiteralLikeNode,
  isVariableDeclaration,
} from 'typescript/ast/is';
import { type Parsed, parseAll, walk } from './checks/syntax.ts';

/** The route methods polly's analyzer reads, as Elysia names them. */
const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

/** Where the anchors come from. */
const VERIFY = '@fairfox/polly/verify';

/**
 * The anchored routes of one file, each named as polly names it: the method
 * and the path as written, `POST /turn`. A route is anchored when its handler
 * calls `requires` or `ensures` imported from @fairfox/polly/verify, under
 * any local name. The handler is the route's second argument: a function
 * written there, or the name of a function declared in the same file.
 */
export function anchoredRoutes({ source }: Parsed): string[] {
  const anchors = new Set<string>();
  for (const statement of source.statements) {
    const bindings = isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (
      isImportDeclaration(statement) &&
      isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === VERIFY &&
      bindings !== undefined &&
      isNamedImports(bindings)
    ) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (imported === 'requires' || imported === 'ensures') {
          anchors.add(element.name.text);
        }
      }
    }
  }
  if (anchors.size === 0) {
    return [];
  }

  const named = new Map<string, Node>();
  walk(source, (node) => {
    if (isFunctionDeclaration(node) && node.name !== undefined) {
      named.set(node.name.text, node);
    } else if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (isArrowFunction(node.initializer) || isFunctionExpression(node.initializer))
    ) {
      named.set(node.name.text, node.initializer);
    }
  });

  const callsAnAnchor = (handler: Node): boolean => {
    let found = false;
    walk(handler, (node) => {
      if (isCallExpression(node) && isIdentifier(node.expression) && anchors.has(node.expression.text)) {
        found = true;
      }
    });
    return found;
  };

  const routes: string[] = [];
  walk(source, (node) => {
    if (!isCallExpression(node) || !isPropertyAccessExpression(node.expression)) {
      return;
    }
    const method = node.expression.name.text;
    const [path, handler] = node.arguments;
    if (!METHODS.has(method) || path === undefined || !isStringLiteralLikeNode(path) || handler === undefined) {
      return;
    }
    const body = isIdentifier(handler) ? named.get(handler.text) : handler;
    if (body !== undefined && callsAnAnchor(body)) {
      routes.push(`${method.toUpperCase()} ${path.text}`);
    }
  });
  return routes;
}

/** The anchored routes of every .ts file under `dir`, at any depth, sorted. */
export async function anchoredRoutesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: { file: string; text: string }[] = [];
  for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.ts'))) {
    const file = join(entry.parentPath, entry.name);
    files.push({ file, text: await Bun.file(file).text() });
  }
  return (await parseAll(files)).flatMap(anchoredRoutes).sort();
}

/** The names polly verify's config puts in its model: `messages.include`, or none. */
export async function includedRoutes(config: string): Promise<string[]> {
  const loaded: unknown = await import(config);
  const value: unknown = typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'default') : undefined;
  const messages: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'messages') : undefined;
  const include: unknown = typeof messages === 'object' && messages !== null ? Reflect.get(messages, 'include') : undefined;
  return Array.isArray(include) ? include.filter((name): name is string => typeof name === 'string').sort() : [];
}
