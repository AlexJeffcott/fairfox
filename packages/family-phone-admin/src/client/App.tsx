/** @jsxImportSource preact */
// Family-phone admin UI — two views: Humans and Devices. Humans are
// added first; each device registers against a human via a pairing
// flow. The pairing token QR display itself is issued by
// @fairfox/shared/pairing and wired up in a later iteration.

import { PairingBanner } from '@fairfox/shared/pairing-banner';
import { Badge, Button, Input, Layout, Tabs } from '@fairfox/ui';
import { useSignal } from '@preact/signals';
import { issuedToken, pairingError, pairingMode, scanInput } from '#src/client/pairing-state.ts';
import { directoryState } from '#src/client/state.ts';

type ViewId = 'humans' | 'devices';

const TAB_LIST = [
  { id: 'humans', label: 'Humans' },
  { id: 'devices', label: 'Devices' },
];

function HumansView() {
  const humans = directoryState.value.humans;
  const devices = directoryState.value.devices;

  return (
    <Layout rows="auto" gap="var(--space-md)">
      <Input
        value=""
        variant="single"
        action="human.add"
        saveOn="enter"
        placeholder="Add a family member..."
        markdown={false}
      />
      {humans.map((h) => {
        const deviceCount = devices.filter((d) => d.humanId === h.id && !d.revokedAt).length;
        return (
          <Layout key={h.id} columns="1fr auto auto" gap="var(--space-sm)" align="center">
            <strong>{h.name}</strong>
            <Badge variant="default">{deviceCount} devices</Badge>
            <Button
              label="Remove"
              size="small"
              tier="tertiary"
              color="error"
              data-action="human.remove"
              data-action-id={h.id}
            />
          </Layout>
        );
      })}
      {humans.length === 0 && (
        <p style={{ color: 'var(--txt-secondary)' }}>No family members yet.</p>
      )}
    </Layout>
  );
}

function DevicesView() {
  const active = directoryState.value.devices.filter((d) => !d.revokedAt);
  const revoked = directoryState.value.devices.filter((d) => d.revokedAt);
  const humansById = new Map(directoryState.value.humans.map((h) => [h.id, h.name]));

  return (
    <Layout rows="auto" gap="var(--space-md)">
      {active.length > 0 && (
        <Layout rows="auto" gap="var(--space-sm)">
          <h3>Active ({active.length})</h3>
          {active.map((d) => (
            <Layout key={d.id} columns="auto 1fr auto auto" gap="var(--space-sm)" align="center">
              <Badge variant="info">{d.kind}</Badge>
              <Layout rows="auto" gap="0">
                <strong>{d.name}</strong>
                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--txt-tertiary)' }}>
                  {humansById.get(d.humanId) ?? 'unknown'} · paired{' '}
                  {new Date(d.pairedAt).toLocaleDateString()}
                </span>
              </Layout>
              <Button
                label="Revoke"
                size="small"
                tier="tertiary"
                color="error"
                data-action="device.revoke"
                data-action-id={d.id}
              />
            </Layout>
          ))}
        </Layout>
      )}
      {revoked.length > 0 && (
        <Layout rows="auto" gap="var(--space-sm)">
          <h3>Revoked ({revoked.length})</h3>
          {revoked.map((d) => (
            <Layout key={d.id} columns="1fr auto" gap="var(--space-sm)" align="center">
              <span style={{ color: 'var(--txt-tertiary)' }}>
                {d.name} · {humansById.get(d.humanId) ?? 'unknown'}
              </span>
              <Badge variant="error">revoked</Badge>
            </Layout>
          ))}
        </Layout>
      )}
      {directoryState.value.devices.length === 0 && (
        <p style={{ color: 'var(--txt-secondary)' }}>No devices yet.</p>
      )}
    </Layout>
  );
}

function PairingPanel() {
  if (pairingMode.value === 'idle') {
    return (
      <Layout columns="auto auto" gap="var(--space-sm)">
        <Button label="Issue pairing token" tier="primary" data-action="pairing.issue" />
        <Button label="Scan a token" tier="secondary" data-action="pairing.scan" />
      </Layout>
    );
  }
  if (pairingMode.value === 'issuing' && issuedToken.value) {
    return (
      <Layout rows="auto" gap="var(--space-sm)">
        <p>
          <strong>Show this token to the new device.</strong> It expires in ten minutes.
        </p>
        <code
          style={{
            wordBreak: 'break-all',
            padding: 'var(--space-sm)',
            background: 'var(--surface-secondary)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-xs)',
          }}
        >
          {issuedToken.value}
        </code>
        <Button label="Done" tier="tertiary" data-action="pairing.cancel" />
      </Layout>
    );
  }
  if (pairingMode.value === 'scanning') {
    return (
      <Layout rows="auto" gap="var(--space-sm)">
        <p>Paste the pairing token from the trusted device.</p>
        <Input
          value={scanInput.value}
          variant="multi"
          action="pairing.submit-scan"
          saveOn="explicit"
          placeholder="Paste token here..."
          markdown={false}
        />
        <Layout columns="auto auto" gap="var(--space-sm)">
          <Button
            label="Apply"
            tier="primary"
            data-action="pairing.submit-scan"
            data-action-value={scanInput.value}
          />
          <Button label="Cancel" tier="tertiary" data-action="pairing.cancel" />
        </Layout>
        {pairingError.value && <p style={{ color: 'var(--color-error)' }}>{pairingError.value}</p>}
      </Layout>
    );
  }
  return null;
}

export function App() {
  const activeTab = useSignal<ViewId>('humans');

  return (
    <Layout rows="auto auto auto 1fr" gap="var(--space-lg)" padding="var(--space-lg)">
      <PairingBanner />
      <Layout rows="auto" gap="var(--space-md)">
        <h1>Family Phone — Admin</h1>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="directory.tab" />
      </Layout>
      <PairingPanel />
      <div>
        {activeTab.value === 'humans' && <HumansView />}
        {activeTab.value === 'devices' && <DevicesView />}
      </div>
    </Layout>
  );
}
