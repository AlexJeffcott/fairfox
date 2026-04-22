/** @jsxImportSource preact */
// Peers view — the per-device list backed by `mesh:devices` and the
// signalling presence signal. Each row surfaces the device's name,
// peer-id prefix, agent, last-seen relative time, and an online dot.
// The row for this device is flagged and offers an inline rename; the
// other rows offer reconnect (close + re-open the mesh client) and
// forget-locally (revoke + drop from this keyring, then reload).

import { ActionInput, Badge, Button, Layout } from '@fairfox/polly/ui';
import { devicesState } from '@fairfox/shared/devices-state';
import { peersPresent } from '@fairfox/shared/peers-presence';
import { canDo, effectivePermissionsForDevice } from '@fairfox/shared/policy';
import { canScanWithCamera, QrImageDropzone } from '@fairfox/shared/qr-scan';
import {
  recoveryBlobDraft,
  userIdentity,
  userSetupError,
} from '@fairfox/shared/user-identity-state';
import { usersState } from '@fairfox/shared/users-state';
import { selfPeerId } from '#src/client/self-peer.ts';

function ConnectIdentityPanel() {
  return (
    <div
      style={{
        border: '1px solid var(--polly-border)',
        borderRadius: '8px',
        padding: 'var(--polly-space-md)',
        background: 'var(--polly-surface-muted, #f5f5f4)',
      }}
    >
      <p
        style={{
          margin: '0 0 var(--polly-space-xs, 0.25rem)',
          fontSize: '0.9rem',
          fontWeight: 600,
        }}
      >
        Connect my identity
      </p>
      <p
        style={{
          margin: '0 0 var(--polly-space-sm, 0.5rem)',
          fontSize: '0.85rem',
          color: 'var(--polly-text-muted, #57534e)',
        }}
      >
        This device is paired but not yet linked to a user — that's why pairing new peers and some
        writes are blocked. Import your recovery blob to finish the hookup.
      </p>
      {canScanWithCamera() && (
        <Layout
          columns="1fr"
          gap="var(--polly-space-sm, 0.5rem)"
          padding="0 0 var(--polly-space-sm, 0.5rem) 0"
        >
          <Button
            label="Scan with camera"
            tier="primary"
            fullWidth={true}
            data-action="users.open-recovery-camera"
          />
        </Layout>
      )}
      <Layout
        columns="1fr"
        gap="var(--polly-space-sm, 0.5rem)"
        padding="0 0 var(--polly-space-sm, 0.5rem) 0"
      >
        <QrImageDropzone mode="recovery" />
      </Layout>
      <ActionInput
        value={recoveryBlobDraft.value}
        variant="single"
        action="users.recovery-blob-input"
        saveOn="blur"
        placeholder="…or paste fairfox-user-v1:…"
        ariaLabel="Recovery blob"
      />
      <Layout
        columns="1fr"
        gap="var(--polly-space-sm, 0.5rem)"
        padding="var(--polly-space-sm, 0.5rem) 0 0 0"
      >
        <Button
          label="Import"
          tier="secondary"
          fullWidth={true}
          data-action="users.import-recovery"
        />
      </Layout>
      {userSetupError.value && (
        <p
          style={{
            margin: 'var(--polly-space-sm, 0.5rem) 0 0',
            color: '#b91c1c',
            fontSize: '0.85rem',
          }}
        >
          {userSetupError.value}
        </p>
      )}
    </div>
  );
}

function PairActions() {
  const canPair = canDo('device.pair');
  if (!canPair) {
    return <ConnectIdentityPanel />;
  }
  return (
    <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
      <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
        Bring another device, CLI, or browser extension into this mesh.
      </span>
      <Button
        label="+ Pair another device"
        tier="primary"
        size="small"
        data-action="pairing.start-issue"
      />
    </Layout>
  );
}

function relativeTime(iso: string): string {
  if (!iso) {
    return '';
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins} min ago`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function agentColor(agent: string): 'info' | 'success' | 'warning' | 'default' {
  switch (agent) {
    case 'cli':
      return 'success';
    case 'extension':
      return 'warning';
    case 'browser':
      return 'info';
    default:
      return 'default';
  }
}

function capabilityPillColor(cap: string): 'info' | 'success' | 'warning' | 'default' {
  switch (cap) {
    case 'webrtc':
    case 'pwa-installed':
      return 'success';
    case 'llm-peer':
      return 'warning';
    case 'camera':
    case 'keyboard':
      return 'info';
    default:
      return 'default';
  }
}

export function PeersView() {
  const selfId = selfPeerId.value;
  // Revoked rows are kept in mesh:devices as tombstones so every peer
  // honours the revocation, but we don't render them — the list is
  // the live roster, not an audit log.
  const entries = Object.values(devicesState.value.devices).filter((e) => !e.revokedAt);
  const online = peersPresent.value;
  const canRevoke = canDo('device.revoke');
  const canPair = canDo('device.pair');
  const localUserId = userIdentity.value?.userId;
  const users = usersState.value.users;

  // Sort: self first, then online peers, then everyone else by name.
  entries.sort((a, b) => {
    if (a.peerId === selfId) {
      return -1;
    }
    if (b.peerId === selfId) {
      return 1;
    }
    const aOnline = online.has(a.peerId);
    const bOnline = online.has(b.peerId);
    if (aOnline !== bOnline) {
      return aOnline ? -1 : 1;
    }
    return (a.name || a.peerId).localeCompare(b.name || b.peerId);
  });

  if (entries.length === 0) {
    return (
      <Layout rows="auto auto" gap="var(--polly-space-md)">
        <PairActions />
        <p style={{ color: 'var(--polly-text-muted)' }}>
          No devices yet. When another device pairs with this one it will show up here.
        </p>
      </Layout>
    );
  }

  return (
    <Layout rows="auto auto" gap="var(--polly-space-md)">
      <PairActions />
      <Layout rows="auto" gap="var(--polly-space-sm)">
        {entries.map((entry) => {
          const isSelf = entry.peerId === selfId;
          const isOnline = online.has(entry.peerId);
          const ownerUserIds = entry.ownerUserIds ?? [];
          const capabilities = entry.capabilities ?? [];
          const effective = Array.from(effectivePermissionsForDevice(entry.peerId)).sort();
          return (
            <Layout
              key={entry.peerId}
              columns="auto 1fr auto"
              gap="var(--polly-space-md)"
              alignItems="center"
              padding="var(--polly-space-md) var(--polly-space-lg)"
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '0.6rem',
                  height: '0.6rem',
                  borderRadius: '9999px',
                  background: isOnline ? 'var(--polly-success)' : 'var(--polly-border)',
                }}
                title={isOnline ? 'online' : 'offline'}
              />
              <Layout rows="auto auto auto auto" gap="0">
                <Layout
                  columns="auto auto auto"
                  gap="var(--polly-space-sm)"
                  alignItems="center"
                  justifyContent="start"
                >
                  {isSelf ? (
                    <ActionInput
                      value={entry.name}
                      variant="single"
                      action="peers.rename-self"
                      saveOn="blur"
                      placeholder="Name this device"
                      ariaLabel="Rename this device"
                    />
                  ) : (
                    <strong>{entry.name || '(unnamed)'}</strong>
                  )}
                  <Badge variant={agentColor(entry.agent)}>{entry.agent}</Badge>
                  {isSelf && <Badge variant="default">this device</Badge>}
                </Layout>
                <span
                  style={{
                    color: 'var(--polly-text-muted)',
                    fontSize: 'var(--polly-text-sm)',
                    fontFamily: 'var(--polly-font-mono)',
                  }}
                >
                  {entry.peerId.slice(0, 12)}
                  {' · '}
                  {isOnline ? 'online' : `last seen ${relativeTime(entry.lastSeenAt)}`}
                </span>
                {ownerUserIds.length > 0 && (
                  <Layout
                    columns="repeat(auto-fit, minmax(0, auto))"
                    gap="var(--polly-space-xs)"
                    alignItems="center"
                    justifyContent="start"
                  >
                    {ownerUserIds.map((userId) => (
                      <Badge key={userId} variant="info">
                        {users[userId]?.displayName ?? userId.slice(0, 8)}
                      </Badge>
                    ))}
                    {capabilities.map((cap) => (
                      <Badge key={cap} variant={capabilityPillColor(cap)}>
                        {cap}
                      </Badge>
                    ))}
                  </Layout>
                )}
                {effective.length > 0 && (
                  <span
                    style={{
                      color: 'var(--polly-text-muted)',
                      fontSize: 'var(--polly-text-sm)',
                      fontStyle: 'italic',
                    }}
                  >
                    can: {effective.join(', ')}
                  </span>
                )}
                {ownerUserIds.length > 0 && effective.length === 0 && (
                  <span
                    style={{
                      color: 'var(--polly-warning, #b45309)',
                      fontSize: 'var(--polly-text-sm)',
                      fontStyle: 'italic',
                    }}
                  >
                    read-only (no endorsed user has any permissions)
                  </span>
                )}
              </Layout>
              {isSelf ? (
                <span />
              ) : (
                <Layout columns="auto auto auto" gap="var(--polly-space-xs)" alignItems="center">
                  <Button
                    label="Reconnect"
                    size="small"
                    tier="tertiary"
                    data-action="peers.reconnect"
                    data-action-peer-id={entry.peerId}
                  />
                  {/* Shared-device add-me: show only when the local
                   * user isn't already endorsed on this device and
                   * holds device.pair. Leaving is self-service; an
                   * admin can force-remove via Forget. */}
                  {localUserId &&
                    canPair &&
                    !ownerUserIds.includes(localUserId) &&
                    entry.agent !== 'cli' && (
                      <Button
                        label="Add me"
                        size="small"
                        tier="secondary"
                        data-action="devices.add-me"
                        data-action-peer-id={entry.peerId}
                      />
                    )}
                  {localUserId && ownerUserIds.includes(localUserId) && (
                    <Button
                      label="Leave"
                      size="small"
                      tier="tertiary"
                      data-action="devices.leave"
                      data-action-peer-id={entry.peerId}
                    />
                  )}
                  {canRevoke && (
                    <Button
                      label="Forget"
                      size="small"
                      tier="tertiary"
                      color="danger"
                      data-action="peers.forget-local"
                      data-action-peer-id={entry.peerId}
                    />
                  )}
                </Layout>
              )}
            </Layout>
          );
        })}
      </Layout>
    </Layout>
  );
}
