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
import { usersState } from '@fairfox/shared/users-state';

export function UsersView(): preact.JSX.Element {
  const users = Object.values(usersState.value.users);
  const selfUserId = userIdentity.value?.userId;
  const canRevoke = canDo('user.revoke');

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
            columns="1fr auto"
            gap="var(--polly-space-md)"
            alignItems="center"
            padding="var(--polly-space-md) var(--polly-space-lg)"
          >
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
        );
      })}
    </Layout>
  );
}
