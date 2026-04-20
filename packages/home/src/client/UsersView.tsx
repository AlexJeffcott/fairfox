/** @jsxImportSource preact */
// UsersView — the admin-facing list of users in the mesh. Visible
// only when the local user holds one of the `user.*` permissions.
// Each row shows displayName, role set, and when present the
// revokedAt timestamp. Admins see a Revoke button on non-self rows;
// the button fires `users.revoke-peer` (Phase E) which writes the
// signed revocation into `mesh:users`. Phase F's accept hook will
// verify the revoker holds `user.revoke`.

import { Badge, Button, Layout } from '@fairfox/polly/ui';
import { canDo } from '@fairfox/shared/policy';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import { type Permission, type UserEntry, usersState } from '@fairfox/shared/users-state';

/** Every permission that makes sense as a fine-grained grant on top
 * of a role. Order matters — the picker renders them in this order
 * so a user scanning the UI sees the most commonly toggled ones
 * (sub-app writes) first. */
const GRANTABLE_PERMISSIONS: readonly Permission[] = [
  'todo.write',
  'agenda.write',
  'agenda.complete-other',
  'subapp.install',
  'device.pair',
  'device.rename',
  'device.revoke',
  'device.designate-llm',
  'user.invite',
  'user.revoke',
  'user.grant-role',
];

function GrantPicker({ user }: { user: UserEntry }): preact.JSX.Element {
  const held = new Set(user.grants.map((g) => g.permission));
  return (
    <Layout
      columns="repeat(auto-fit, minmax(10rem, 1fr))"
      gap="var(--polly-space-xs)"
      alignItems="center"
      justifyContent="start"
      padding="var(--polly-space-sm) 0 0 0"
    >
      {GRANTABLE_PERMISSIONS.map((perm) => (
        <Button
          key={perm}
          label={`${held.has(perm) ? '✓ ' : ''}${perm}`}
          size="small"
          tier={held.has(perm) ? 'primary' : 'tertiary'}
          data-action="users.toggle-grant"
          data-action-user-id={user.userId}
          data-action-permission={perm}
        />
      ))}
    </Layout>
  );
}

export function UsersView(): preact.JSX.Element {
  const users = Object.values(usersState.value.users);
  const selfUserId = userIdentity.value?.userId;
  const canRevoke = canDo('user.revoke');
  const canGrant = canDo('user.grant-role');

  if (users.length === 0) {
    return (
      <p style={{ color: 'var(--polly-text-muted)' }}>
        No users yet. Invite someone through the pairing wizard to populate the list.
      </p>
    );
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-sm)">
      {users.map((user) => {
        const isSelf = user.userId === selfUserId;
        const isRevoked = Boolean(user.revokedAt);
        return (
          <Layout
            key={user.userId}
            rows="auto auto"
            gap="var(--polly-space-sm)"
            padding="var(--polly-space-md) var(--polly-space-lg)"
          >
            <Layout columns="1fr auto" gap="var(--polly-space-md)" alignItems="center">
              <Layout rows="auto auto" gap="0">
                <Layout
                  columns="auto auto auto"
                  gap="var(--polly-space-sm)"
                  alignItems="center"
                  justifyContent="start"
                >
                  <strong style={isRevoked ? { textDecoration: 'line-through' } : undefined}>
                    {user.displayName}
                  </strong>
                  {user.roles.map((role) => (
                    <Badge
                      key={role}
                      variant={role === 'admin' ? 'warning' : role === 'guest' ? 'default' : 'info'}
                    >
                      {role}
                    </Badge>
                  ))}
                  {isSelf && <Badge variant="success">you</Badge>}
                  {isRevoked && <Badge variant="default">revoked</Badge>}
                </Layout>
                <span
                  style={{
                    color: 'var(--polly-text-muted)',
                    fontSize: 'var(--polly-text-sm)',
                    fontFamily: 'var(--polly-font-mono)',
                  }}
                >
                  {user.userId.slice(0, 16)}
                </span>
              </Layout>
              {!isSelf && !isRevoked && canRevoke && (
                <Button
                  label="Revoke"
                  size="small"
                  tier="tertiary"
                  color="danger"
                  data-action="users.revoke-peer"
                  data-action-user-id={user.userId}
                />
              )}
            </Layout>
            {canGrant && !isRevoked && <GrantPicker user={user} />}
          </Layout>
        );
      })}
    </Layout>
  );
}
