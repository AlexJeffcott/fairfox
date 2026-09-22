/** A list of permissions: each kind of thing, and the actions allowed on it (I18). */
export type PermissionList = Readonly<Record<string, readonly string[]>>;

/**
 * The one typed list of permissions (I18). Server, client and tests import it.
 * Empty until stage 1.
 */
export const permissions: PermissionList = {};

/** One entry of a list: one action on one kind of thing. A grant row holds one. */
export type Entry = { kind: string; action: string };

/**
 * Every entry of a list, one for each action of each kind, in the list's
 * order. The first member gets a grant row for each entry (I5), and a check
 * fails on an entry that no active member holds (I18).
 */
export function entries(list: PermissionList): Entry[] {
  return Object.entries(list).flatMap(([kind, actions]) => actions.map((action) => ({ kind, action })));
}
