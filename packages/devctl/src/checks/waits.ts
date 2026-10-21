import type { CallExpression, Node } from 'typescript/ast';
import {
  isBindingElement,
  isCallExpression,
  isElementAccessExpression,
  isFunctionLikeDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isNewExpression,
  isObjectBindingPattern,
  isParameterDeclaration,
  isPropertyAccessExpression,
  isStringLiteral,
  isStringLiteralLikeNode,
  isVariableDeclaration,
} from 'typescript/ast/is';
import { type Finding, finding, type Parsed, walk } from './syntax.ts';

const BUN = new Set(['Bun']);
const BUN_SLEEPS = new Set(['sleep', 'sleepSync']);
const TIMERS = new Set(['setTimeout', 'setInterval']);
const GLOBALS = new Set(['globalThis', 'window', 'global', 'self']);
const TIMER_MODULES = new Set(['node:timers/promises', 'timers/promises']);
const PROMISE = new Set(['Promise']);
/** eal's names for a resolve function handed straight to a timer, as from Promise.withResolvers(). */
const RESOLVE_NAMES = new Set(['resolve', 'res', 'done', '_resolve', 'r', 'ok']);

/** Whether `node` is an identifier with one of `names`. */
function named(node: Node | undefined, names: ReadonlySet<string>): boolean {
  return node !== undefined && isIdentifier(node) && names.has(node.text);
}

/** `setTimeout(...)` or `setInterval(...)`, called bare or through `globalThis`, `window`, `global` or `self`. */
function isTimerCall(node: Node): node is CallExpression {
  if (!isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  if (isPropertyAccessExpression(callee)) {
    return named(callee.expression, GLOBALS) && TIMERS.has(callee.name.text);
  }
  return named(callee, TIMERS);
}

/** `Bun.sleep` or `Bun.sleepSync`, called or not; or `Bun['sleep']`. */
function isBunSleep(node: Node): boolean {
  if (isPropertyAccessExpression(node)) {
    return named(node.expression, BUN) && BUN_SLEEPS.has(node.name.text);
  }
  if (isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    return named(node.expression, BUN) && isStringLiteralLikeNode(key) && BUN_SLEEPS.has(key.text);
  }
  return false;
}

/** `const { sleep } = Bun`, `{ sleep: nap }`, a parameter `({ sleep } = Bun)`, or a nested default `{ a: { sleep } = Bun }`. */
function isBunSleepTaken(node: Node): boolean {
  // Stryker disable next-line ConditionalExpression: equivalent, no other kind of node has a binding pattern for a name
  const declares = isVariableDeclaration(node) || isParameterDeclaration(node) || isBindingElement(node);
  // Stryker disable next-line ConditionalExpression: equivalent, a binding with an initializer always has a name
  if (!declares || !named(node.initializer, BUN) || node.name === undefined || !isObjectBindingPattern(node.name)) {
    return false;
  }
  return node.name.elements.some((e) => named(e.propertyName ?? e.name, BUN_SLEEPS));
}

/** `import { sleep } from 'bun'`, or any import from timers/promises, whose timers wait a fixed time. */
function isSleepImport(node: Node): boolean {
  // Stryker disable next-line ConditionalExpression: equivalent, the module of an import declaration is always a string literal
  if (!isImportDeclaration(node) || !isStringLiteral(node.moduleSpecifier)) {
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
    isNamedImports(bindings) &&
    bindings.elements.some((e) => named(e.propertyName ?? e.name, BUN_SLEEPS))
  );
}

/** Whether `node` holds a call to the function named `name`. */
function calls(node: Node, name: string): boolean {
  if (isCallExpression(node) && named(node.expression, new Set([name]))) {
    return true;
  }
  return node.forEachChild((child) => calls(child, name) || undefined) === true;
}

/** The timer calls inside `new Promise((resolve) => ...)` that resolve it: `setTimeout(resolve, n)`, `setTimeout(() => resolve(), n)`. */
function resolvingTimers(parsed: Parsed, node: Node): CallExpression[] {
  if (!isNewExpression(node) || !named(node.expression, PROMISE)) {
    return [];
  }
  const executor = node.arguments?.[0];
  if (executor === undefined || !isFunctionLikeDeclaration(executor)) {
    return [];
  }
  const [first] = executor.parameters;
  if (first === undefined) {
    return [];
  }
  // A destructured first parameter, such as `({ go })`, names no function: its text matches no call.
  const resolve = first.name.getText(parsed.source);
  const found: CallExpression[] = [];
  walk(executor, (child) => {
    if (!isTimerCall(child)) {
      return;
    }
    const [callback] = child.arguments;
    if (named(callback, new Set([resolve])) || (callback !== undefined && isFunctionLikeDeclaration(callback) && calls(callback, resolve))) {
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
export function findFixedWaits(parsed: Parsed): Finding[] {
  const found = new Map<Node, string>();
  walk(parsed.source, (node) => {
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
    if (isCallExpression(node) && isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForTimeout') {
      found.set(node, 'waitForTimeout');
    }
    for (const timer of resolvingTimers(parsed, node)) {
      found.set(timer, 'a timer that resolves a promise');
    }
  });
  return [...found].map(([node, reason]) => finding(parsed, node, reason)).sort((a, b) => a.line - b.line);
}
