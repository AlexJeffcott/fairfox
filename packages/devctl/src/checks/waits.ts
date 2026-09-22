import ts from 'typescript';
import { type Finding, finding, parse, walk } from './syntax.ts';

const BUN = new Set(['Bun']);
const BUN_SLEEPS = new Set(['sleep', 'sleepSync']);
const TIMERS = new Set(['setTimeout', 'setInterval']);
const GLOBALS = new Set(['globalThis', 'window', 'global', 'self']);
const TIMER_MODULES = new Set(['node:timers/promises', 'timers/promises']);
const PROMISE = new Set(['Promise']);
/** eal's names for a resolve function handed straight to a timer, as from Promise.withResolvers(). */
const RESOLVE_NAMES = new Set(['resolve', 'res', 'done', '_resolve', 'r', 'ok']);

/** Whether `node` is an identifier with one of `names`. */
function named(node: ts.Node | undefined, names: ReadonlySet<string>): boolean {
  return node !== undefined && ts.isIdentifier(node) && names.has(node.text);
}

/** `setTimeout(...)` or `setInterval(...)`, called bare or through `globalThis`, `window`, `global` or `self`. */
function isTimerCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return named(callee.expression, GLOBALS) && TIMERS.has(callee.name.text);
  }
  return named(callee, TIMERS);
}

/** `Bun.sleep` or `Bun.sleepSync`, called or not; or `Bun['sleep']`. */
function isBunSleep(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return named(node.expression, BUN) && BUN_SLEEPS.has(node.name.text);
  }
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    return named(node.expression, BUN) && ts.isStringLiteralLike(key) && BUN_SLEEPS.has(key.text);
  }
  return false;
}

/** `const { sleep } = Bun`, `{ sleep: nap }`, a parameter `({ sleep } = Bun)`, or a nested default `{ a: { sleep } = Bun }`. */
function isBunSleepTaken(node: ts.Node): boolean {
  // Stryker disable next-line ConditionalExpression: equivalent, no other kind of node has a binding pattern for a name
  const declares = ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node);
  if (!declares || !named(node.initializer, BUN) || !ts.isObjectBindingPattern(node.name)) {
    return false;
  }
  return node.name.elements.some((e) => named(e.propertyName ?? e.name, BUN_SLEEPS));
}

/** `import { sleep } from 'bun'`, or any import from timers/promises, whose timers wait a fixed time. */
function isSleepImport(node: ts.Node): boolean {
  // Stryker disable next-line ConditionalExpression: equivalent, the module of an import declaration is always a string literal
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
    return false;
  }
  const from = node.moduleSpecifier.text;
  if (TIMER_MODULES.has(from)) {
    return true;
  }
  const bindings = node.importClause?.namedBindings;
  return (
    from === 'bun' &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((e) => named(e.propertyName ?? e.name, BUN_SLEEPS))
  );
}

/** Whether `node` holds a call to the function named `name`. */
function calls(node: ts.Node, name: string): boolean {
  if (ts.isCallExpression(node) && named(node.expression, new Set([name]))) {
    return true;
  }
  return ts.forEachChild(node, (child) => calls(child, name) || undefined) === true;
}

/** The timer calls inside `new Promise((resolve) => ...)` that resolve it: `setTimeout(resolve, n)`, `setTimeout(() => resolve(), n)`. */
function resolvingTimers(source: ts.SourceFile, node: ts.Node): ts.CallExpression[] {
  if (!ts.isNewExpression(node) || !named(node.expression, PROMISE)) {
    return [];
  }
  const executor = node.arguments?.[0];
  if (!ts.isFunctionLike(executor)) {
    return [];
  }
  const [first] = executor.parameters;
  if (first === undefined) {
    return [];
  }
  // A destructured first parameter, such as `({ go })`, names no function: its text matches no call.
  const resolve = first.name.getText(source);
  const found: ts.CallExpression[] = [];
  walk(executor, (child) => {
    if (!isTimerCall(child)) {
      return;
    }
    const [callback] = child.arguments;
    if (named(callback, new Set([resolve])) || (ts.isFunctionLike(callback) && calls(callback, resolve))) {
      found.push(child);
    }
  });
  return found;
}

/**
 * Every fixed-duration wait in one file: a wait that guesses how long an
 * operation takes. The file is parsed, not scanned: a string or a comment
 * that names a wait is not one. A timer that rejects a promise is a time
 * limit, not a wait, and is not reported. Findings are in the order of their
 * lines.
 */
export function findFixedWaits(file: string, text: string): Finding[] {
  const source = parse(file, text);
  const found = new Map<ts.Node, string>();
  walk(source, (node) => {
    if (isBunSleep(node)) {
      found.set(node, 'Bun.sleep');
    }
    if (isBunSleepTaken(node)) {
      found.set(node, 'Bun.sleep, destructured');
    }
    if (isSleepImport(node)) {
      found.set(node, 'a sleep imported from bun or timers/promises');
    }
    if (isTimerCall(node) && named(node.arguments[0], RESOLVE_NAMES)) {
      found.set(node, 'a timer that resolves a promise');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForTimeout') {
      found.set(node, 'waitForTimeout');
    }
    for (const timer of resolvingTimers(source, node)) {
      found.set(timer, 'a timer that resolves a promise');
    }
  });
  return [...found].map(([node, reason]) => finding(source, node, reason)).sort((a, b) => a.line - b.line);
}
