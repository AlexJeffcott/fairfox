// Unit tests for the role → permission mapping and the intersection
// semantics. Doesn't exercise canDo() directly because canDo reads
// devicesState and usersState, which require a live mesh boot;
// ROLE_PERMISSIONS and permissionsForUser are pure and testable
// against a stub `usersState.value`.

import { describe, expect, test } from 'bun:test';
import { permissionsForEntry, ROLE_PERMISSIONS } from '#src/policy.ts';
import type { UserEntry } from '#src/users-state.ts';

function makeUser(id: string, roles: UserEntry['roles'], revokedAt?: string): UserEntry {
  return {
    userId: id,
    displayName: id,
    roles,
    grants: [],
    createdByUserId: id,
    createdAt: '2026-04-20T00:00:00.000Z',
    signature: [],
    revokedAt,
  };
}

describe('ROLE_PERMISSIONS', () => {
  test('admin holds everything', () => {
    const admin = new Set(ROLE_PERMISSIONS.admin);
    expect(admin.has('user.invite')).toBe(true);
    expect(admin.has('user.revoke')).toBe(true);
    expect(admin.has('device.revoke')).toBe(true);
    expect(admin.has('todo.write')).toBe(true);
    expect(admin.has('agenda.complete-other')).toBe(true);
  });

  test('member can write sub-app state but cannot admin users', () => {
    const member = new Set(ROLE_PERMISSIONS.member);
    expect(member.has('todo.write')).toBe(true);
    expect(member.has('agenda.write')).toBe(true);
    expect(member.has('user.invite')).toBe(false);
    expect(member.has('device.revoke')).toBe(false);
  });

  test('guest gets nothing by default', () => {
    expect(ROLE_PERMISSIONS.guest).toHaveLength(0);
  });

  test('llm can write todo and agenda only', () => {
    const llm = new Set(ROLE_PERMISSIONS.llm);
    expect(llm.has('todo.write')).toBe(true);
    expect(llm.has('agenda.write')).toBe(true);
    expect(llm.has('user.invite')).toBe(false);
    expect(llm.has('device.pair')).toBe(false);
  });
});

describe('permissionsForEntry', () => {
  test('flattens roles into a permission set', () => {
    const perms = permissionsForEntry(makeUser('u-admin', ['admin']));
    expect(perms.has('user.invite')).toBe(true);
    expect(perms.has('todo.write')).toBe(true);
  });

  test('grants compose with roles', () => {
    const withGrant: UserEntry = {
      ...makeUser('u-guest', ['guest']),
      grants: [{ permission: 'todo.write' }],
    };
    const perms = permissionsForEntry(withGrant);
    expect(perms.has('todo.write')).toBe(true);
    // Guest + todo.write grant does NOT imply anything else.
    expect(perms.has('user.invite')).toBe(false);
  });

  test('revoked users return empty set regardless of roles', () => {
    const perms = permissionsForEntry(makeUser('u-admin', ['admin'], '2026-04-21T00:00:00.000Z'));
    expect(perms.size).toBe(0);
  });

  test('undefined user returns empty set', () => {
    const perms = permissionsForEntry(undefined);
    expect(perms.size).toBe(0);
  });

  test('intersection: admin + guest collapses to the guest set', () => {
    // The intersection of admin's perms and guest's perms is empty
    // (guest has no perms). This is the load-bearing shared-device
    // property — adding a guest to a shared tablet strips admin from
    // that tablet.
    const admin = permissionsForEntry(makeUser('u-admin', ['admin']));
    const guest = permissionsForEntry(makeUser('u-guest', ['guest']));
    const intersection = new Set<string>();
    for (const p of admin) {
      if (guest.has(p)) {
        intersection.add(p);
      }
    }
    expect(intersection.size).toBe(0);
  });

  test('intersection: admin + member yields the member set', () => {
    const admin = permissionsForEntry(makeUser('u-admin', ['admin']));
    const member = permissionsForEntry(makeUser('u-member', ['member']));
    const intersection = new Set<string>();
    for (const p of admin) {
      if (member.has(p)) {
        intersection.add(p);
      }
    }
    expect(intersection.has('todo.write')).toBe(true);
    expect(intersection.has('device.pair')).toBe(true);
    expect(intersection.has('user.invite')).toBe(false);
    expect(intersection.has('device.revoke')).toBe(false);
  });
});
