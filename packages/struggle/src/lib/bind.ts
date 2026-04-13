/**
 * bun:sqlite accepts named bindings (`{ $key: value }`) at runtime, but its
 * variadic `run`/`all`/`get` type signature declares `SQLQueryBindings[]`
 * (an array), so object literals trip the excess-property check. This helper
 * localises the cast to one place for the transplanted struggle routes.
 */
export const bind = <T extends Record<string, string | number | null | boolean>>(o: T): any => o;
