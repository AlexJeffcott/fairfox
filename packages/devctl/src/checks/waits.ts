import ts from 'typescript';
import { type Finding, finding, parse, walk } from './syntax.ts';

const TIMERS = new Set(['setTimeout', 'setInterval']);
const GLOBALS = new Set(['globalThis', 'window', 'global', 'self']);
const BUN_SLEEPS = new Set(['sleep', 'sleepSync']);
const TIMER_MODULES = new Set(['node:timers/promises', 'timers/promises']);
const PROMISE_TIMERS = new Set(['setTimeout', 'setInterval', 'scheduler']);
/** eal's names for a resolve function handed straight to a timer, as from Promise.withResolvers(). */
const RESOLVE_NAMES = new Set(['resolve', 'res', 'done', '_resolve', 'r', 'ok']);

function named(node: ts.Node, names: ReadonlySet<string>): boolean {
  return ts.isIdentifier(node) && names.has(node.text);
}

/** `setTimeout(...)`, `setInterval(...)`, or either through `globalThis`, `window`, `global` or `self`. */
function isTimerCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  return (
    named(callee, TIMERS) ||
    (ts.isPropertyAccessExpression(callee) && named(callee.expression, GLOBALS) && named(callee.name, TIMERS))
  );
}

/** `Bun.sleep`, `Bun.sleepSync`, `Bun['sleep']`, called or not. */
function isBunSleep(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return named(node.expression, new Set(['Bun'])) && named(node.name, BUN_SLEEPS);
  }
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    return named(node.expression, new Set(['Bun'])) && ts.isStringLiteralLike(key) && BUN_SLEEPS.has(key.text);
  }
  return false;
}

/** The names a destructuring or an import takes from its source: `{ sleep }`, `{ sleep: nap }`. */
function takes(elements: readonly (ts.BindingElement | ts.ImportSpecifier)[], names: ReadonlySet<string>): boolean {
  return elements.some((e) => {
    const taken = e.propertyName ?? e.name;
    return (ts.isIdentifier(taken) || ts.isStringLiteral(taken)) && names.has(taken.text);
  });
}

/** `const { sleep } = Bun`. */
function isBunSleepTaken(node: ts.Node): boolean {
  return (
    ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    named(node.initializer, new Set(['Bun'])) &&
    ts.isObjectBindingPattern(node.name) &&
    takes(node.name.elements, BUN_SLEEPS)
  );
}

/** An import of a sleep: `sleep` from 'bun', or a timer from 'node:timers/promises', named, whole or dynamic. */
function isSleepImport(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause !== undefined) {
    const from = node.moduleSpecifier.text;
    const bindings = node.importClause.namedBindings;
    if (from === 'bun') {
      return bindings !== undefined && ts.isNamedImports(bindings) && takes(bindings.elements, BUN_SLEEPS);
    }
    if (TIMER_MODULES.has(from)) {
      return (
        node.importClause.name !== undefined ||
        (bindings !== undefined && (ts.isNamespaceImport(bindings) || takes(bindings.elements, PROMISE_TIMERS)))
      );
    }
    return false;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [from] = node.arguments;
    return from !== undefined && ts.isStringLiteralLike(from) && TIMER_MODULES.has(from.text);
  }
  return false;
}

/** Whether `node` holds a call to the function named `name`. */
function calls(node: ts.Node, name: string): boolean {
  let found = false;
  const step = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name) {
      found = true;
    }
    ts.forEachChild(child, step);
  };
  step(node);
  return found;
}

/** The timer calls inside `new Promise((resolve) => ...)` that resolve it: `setTimeout(resolve, n)`, `setTimeout(() => resolve(), n)`. */
function resolvingTimers(node: ts.Node): ts.CallExpression[] {
  if (!ts.isNewExpression(node) || !named(node.expression, new Set(['Promise']))) {
    return [];
  }
  const executor = node.arguments?.[0];
  if (executor === undefined || !(ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))) {
    return [];
  }
  const resolve = executor.parameters[0]?.name;
  if (resolve === undefined || !ts.isIdentifier(resolve)) {
    return [];
  }
  const found: ts.CallExpression[] = [];
  const step = (child: ts.Node): void => {
    if (isTimerCall(child)) {
      const [callback] = child.arguments;
      if (
        callback !== undefined &&
        ((ts.isIdentifier(callback) && callback.text === resolve.text) ||
          ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && calls(callback, resolve.text)))
      ) {
        found.push(child);
      }
    }
    ts.forEachChild(child, step);
  };
  ts.forEachChild(executor, step);
  return found;
}

/**
 * Every fixed-duration wait in one file: a wait that guesses how long an
 * operation takes. The file is parsed, not scanned: a string or a comment
 * that names a wait is not one. A timer that rejects a promise is a time
 * limit, not a wait, and is not reported.
 */
export function findFixedWaits(file: string, text: string): Finding[] {
  const source = parse(file, text);
  const found = new Map<ts.Node, Finding>();
  const report = (node: ts.Node, reason: string): void => {
    if (!found.has(node)) {
      found.set(node, finding(source, node, reason));
    }
  };
  walk(source, (node) => {
    if (isBunSleep(node)) {
      report(node, 'Bun.sleep');
    } else if (isBunSleepTaken(node)) {
      report(node, 'Bun.sleep, destructured');
    } else if (isSleepImport(node)) {
      report(node, 'a sleep imported from bun or timers/promises');
    } else if (isTimerCall(node) && node.arguments[0] !== undefined && named(node.arguments[0], RESOLVE_NAMES)) {
      report(node, 'a timer that resolves a promise');
    } else if (
      ts.isCallExpression(node) &&
      (named(node.expression, new Set(['waitForTimeout'])) ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForTimeout'))
    ) {
      report(node, 'waitForTimeout');
    }
    for (const timer of resolvingTimers(node)) {
      report(timer, 'a timer that resolves a promise');
    }
  });
  return [...found.values()].sort((a, b) => a.line - b.line);
}
