// Policy — the local permission gate that UI and action handlers
// consult to decide whether the current device+user can perform a
// given action. Not a security boundary: a malicious peer with a
// local code fork can bypass `canDo`. The mitigation is Phase F's
// crypto accept-hook and Phase H's admin-wielded `device.revoke`.
// `canDo` stops a well-behaved peer from accidentally overstepping,
// and hides UI that wouldn't work anyway.
//
// The effective permission set of a device is the *intersection* of
// every endorsed user's permission set. Shared tablet with Alex +
// Leo on it can do only what both can do; Alex's laptop (only Alex)
// keeps his full admin. Revoked users contribute the empty set,
// which collapses the whole intersection to empty — so revoking the
// last non-revoked user on a shared device effectively puts it in
// read-only mode.

import { devicesState } from '#src/devices-state.ts';
import { userIdentity } from '#src/user-identity-state.ts';
import {
  liveUser,
  type Permission,
  type Role,
  type UserEntry,
  usersState,
} from '#src/users-state.ts';

/** Every permission a role implies. Order-independent — the caller
 * flattens into a Set. Fine-grained `grants` on a user compose on
 * top, so the role table only has to cover the "typical" shape. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    'user.invite',
    'user.revoke',
    'user.grant-role',
    'device.pair',
    'device.rename',
    'device.revoke',
    'device.designate-llm',
    'subapp.install',
    'todo.write',
    'agenda.write',
    'agenda.complete-other',
  ],
  member: ['device.pair', 'device.rename', 'todo.write', 'agenda.write'],
  guest: [],
  llm: ['todo.write', 'agenda.write'],
};

/** Pure variant: flatten a `UserEntry` into its permission set.
 * Returns empty for undefined or revoked users. Kept pure so tests
 * can call it without booting a mesh Repo. */
export function permissionsForEntry(entry: UserEntry | undefined): Set<Permission> {
  const result = new Set<Permission>();
  if (!entry || entry.revokedAt) {
    return result;
  }
  for (const role of entry.roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      result.add(permission);
    }
  }
  for (const grant of entry.grants) {
    // Scoped grants are reserved for later ("alex can todo.write on
    // project P01 only"); today they're treated as unconditional so
    // the storage shape is stable across the switch.
    result.add(grant.permission);
  }
  return result;
}

/** Flatten a user's roles + fine-grained grants into a Set. A
 * revoked user returns the empty set regardless of their roles. */
export function permissionsForUser(userId: string): Set<Permission> {
  return permissionsForEntry(liveUser(userId));
}

/** Intersect the permission sets of every endorsed user on a
 * device. Lives on this file rather than devices-state.ts because
 * the intersection depends on `usersState`, not just `devicesState`.
 * An empty `ownerUserIds` yields the empty set — unendorsed devices
 * can't do anything. */
export function effectivePermissionsForDevice(peerId: string): Set<Permission> {
  const device = devicesState.value.devices[peerId];
  if (!device || device.revokedAt) {
    return new Set();
  }
  const owners = device.ownerUserIds ?? [];
  if (owners.length === 0) {
    return new Set();
  }
  const perUser: Set<Permission>[] = owners.map((id) => permissionsForUser(id));
  // Intersection: start with the first user's set, then drop
  // anything the remaining users don't have.
  const intersection = new Set<Permission>(perUser[0]);
  for (let i = 1; i < perUser.length; i += 1) {
    const other = perUser[i];
    if (!other) {
      continue;
    }
    for (const permission of Array.from(intersection)) {
      if (!other.has(permission)) {
        intersection.delete(permission);
      }
    }
  }
  return intersection;
}

/** The local device's peer id, derived from the keyring. Returns
 * undefined in non-browser environments or before the keyring has
 * loaded — the caller treats that as "can't do anything yet." */
function selfPeerIdFromKeyring(): string | undefined {
  // Read the keyring asynchronously? Callers want a synchronous
  // gate. The keyring's identity.publicKey is stable and can be
  // derived from any loaded keyring. devices-state writes a row for
  // this device on every boot, so after the first render the row
  // exists in `mesh:devices` keyed by this peer's id. The one entry
  // whose row has been endorsed by our `userIdentity` is the local
  // device — find it by ownerUserIds lookup.
  const identity = userIdentity.value;
  if (!identity) {
    return undefined;
  }
  for (const [peerId, entry] of Object.entries(devicesState.value.devices)) {
    const owners = entry.ownerUserIds ?? [];
    if (owners.includes(identity.userId)) {
      return peerId;
    }
  }
  return undefined;
}

/** Check whether the local device, under the local user's identity,
 * holds a given permission. Synchronous and reactive via signals —
 * callers use it inside `useSignal` / JSX to hide UI. `scope` is
 * reserved for future fine-grained grants; currently unused. */
export function canDo(permission: Permission, _scope?: string): boolean {
  const peerId = selfPeerIdFromKeyring();
  if (!peerId) {
    return false;
  }
  const permissions = effectivePermissionsForDevice(peerId);
  return permissions.has(permission);
}

/** Return the current user's userId, or undefined if no identity
 * has been declared yet. Useful for the "acting as <name>" badge. */
export function currentUserId(): string | undefined {
  return userIdentity.value?.userId;
}

/** Aggregated snapshot of the local device's effective permissions.
 * UI consumers call this once per render to show "can: todo.write,
 * agenda.write" rather than repeatedly calling canDo. */
export function currentEffectivePermissions(): Set<Permission> {
  // Unused here, but kept for future usersState read dependency. */
  void usersState.value;
  const peerId = selfPeerIdFromKeyring();
  if (!peerId) {
    return new Set();
  }
  return effectivePermissionsForDevice(peerId);
}
