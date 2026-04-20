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
import { selfPeerId } from '#src/client/self-peer.ts';

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

export function PeersView() {
  const selfId = selfPeerId.value;
  const entries = Object.values(devicesState.value.devices);
  const online = peersPresent.value;

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
      <p style={{ color: 'var(--polly-text-muted)' }}>
        No devices yet. When another device pairs with this one it will show up here.
      </p>
    );
  }

  return (
    <Layout rows="auto" gap="var(--polly-space-sm)">
      {entries.map((entry) => {
        const isSelf = entry.peerId === selfId;
        const isOnline = online.has(entry.peerId);
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
            <Layout rows="auto auto" gap="0">
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
            </Layout>
            {isSelf ? (
              <span />
            ) : (
              <Layout columns="auto auto" gap="var(--polly-space-xs)" alignItems="center">
                <Button
                  label="Reconnect"
                  size="small"
                  tier="tertiary"
                  data-action="peers.reconnect"
                  data-action-peer-id={entry.peerId}
                />
                <Button
                  label="Forget"
                  size="small"
                  tier="tertiary"
                  color="danger"
                  data-action="peers.forget-local"
                  data-action-peer-id={entry.peerId}
                />
              </Layout>
            )}
          </Layout>
        );
      })}
    </Layout>
  );
}
