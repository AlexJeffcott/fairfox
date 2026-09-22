import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { parse, walk } from './checks/syntax.ts';

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
export function anchoredRoutes(file: string, text: string): string[] {
  const source = parse(file, text);
  const anchors = new Set<string>();
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === VERIFY &&
      bindings !== undefined &&
      ts.isNamedImports(bindings)
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

  const named = new Map<string, ts.Node>();
  walk(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      named.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      named.set(node.name.text, node.initializer);
    }
  });

  const callsAnAnchor = (handler: ts.Node): boolean => {
    let found = false;
    walk(handler, (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && anchors.has(node.expression.text)) {
        found = true;
      }
    });
    return found;
  };

  const routes: string[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return;
    }
    const method = node.expression.name.text;
    const [path, handler] = node.arguments;
    if (!METHODS.has(method) || path === undefined || !ts.isStringLiteralLike(path) || handler === undefined) {
      return;
    }
    const body = ts.isIdentifier(handler) ? named.get(handler.text) : handler;
    if (body !== undefined && callsAnAnchor(body)) {
      routes.push(`${method.toUpperCase()} ${path.text}`);
    }
  });
  return routes;
}

/** The anchored routes of every .ts file under `dir`, at any depth, sorted. */
export async function anchoredRoutesIn(dir: string): Promise<string[]> {
  const routes: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.ts'))) {
    const file = join(entry.parentPath, entry.name);
    routes.push(...anchoredRoutes(file, await Bun.file(file).text()));
  }
  return routes.sort();
}

/** The names polly verify's config puts in its model: `messages.include`, or none. */
export async function includedRoutes(config: string): Promise<string[]> {
  const loaded: unknown = await import(config);
  const value: unknown = typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'default') : undefined;
  const messages: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'messages') : undefined;
  const include: unknown = typeof messages === 'object' && messages !== null ? Reflect.get(messages, 'include') : undefined;
  return Array.isArray(include) ? include.filter((name): name is string => typeof name === 'string').sort() : [];
}
