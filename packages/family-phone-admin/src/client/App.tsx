/** @jsxImportSource preact */
// Family-phone admin UI — two views: Humans and Devices. Pairing is
// gated by @fairfox/shared/mesh-gate at boot, so this file never has
// to render the login surface itself.

import { ActionInput, Badge, Button, Layout, Tabs } from '@fairfox/polly/ui';
import { MeshControls } from '@fairfox/shared/mesh-controls';
import { useSignal } from '@preact/signals';
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
    <Layout rows="auto" gap="var(--polly-space-md)">
      <ActionInput
        value=""
        variant="single"
        action="human.add"
        saveOn="enter"
        placeholder="Add a family member..."
      />
      {humans.map((h) => {
        const deviceCount = devices.filter((d) => d.humanId === h.id && !d.revokedAt).length;
        return (
          <Layout
            key={h.id}
            columns="1fr auto auto"
            gap="var(--polly-space-sm)"
            alignItems="center"
          >
            <strong>{h.name}</strong>
            <Badge variant="default">{deviceCount} devices</Badge>
            <Button
              label="Remove"
              size="small"
              tier="tertiary"
              color="danger"
              data-action="human.remove"
              data-action-id={h.id}
            />
          </Layout>
        );
      })}
      {humans.length === 0 && (
        <p style={{ color: 'var(--polly-text-muted)' }}>No family members yet.</p>
      )}
    </Layout>
  );
}

function DevicesView() {
  const active = directoryState.value.devices.filter((d) => !d.revokedAt);
  const revoked = directoryState.value.devices.filter((d) => d.revokedAt);
  const humansById = new Map(directoryState.value.humans.map((h) => [h.id, h.name]));

  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      {active.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Active ({active.length})</h3>
          {active.map((d) => (
            <Layout
              key={d.id}
              columns="auto 1fr auto auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              <Badge variant="info">{d.kind}</Badge>
              <Layout rows="auto" gap="0">
                <strong>{d.name}</strong>
                <span
                  style={{ fontSize: 'var(--polly-text-xs)', color: 'var(--polly-text-muted)' }}
                >
                  {humansById.get(d.humanId) ?? 'unknown'} · paired{' '}
                  {new Date(d.pairedAt).toLocaleDateString()}
                </span>
              </Layout>
              <Button
                label="Revoke"
                size="small"
                tier="tertiary"
                color="danger"
                data-action="device.revoke"
                data-action-id={d.id}
              />
            </Layout>
          ))}
        </Layout>
      )}
      {revoked.length > 0 && (
        <Layout rows="auto" gap="var(--polly-space-sm)">
          <h3>Revoked ({revoked.length})</h3>
          {revoked.map((d) => (
            <Layout key={d.id} columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
              <span style={{ color: 'var(--polly-text-muted)' }}>
                {d.name} · {humansById.get(d.humanId) ?? 'unknown'}
              </span>
              <Badge variant="danger">revoked</Badge>
            </Layout>
          ))}
        </Layout>
      )}
      {directoryState.value.devices.length === 0 && (
        <p style={{ color: 'var(--polly-text-muted)' }}>No devices yet.</p>
      )}
    </Layout>
  );
}

export function App() {
  const activeTab = useSignal<ViewId>('humans');

  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <h1 style={{ margin: 0 }}>Family Phone — Admin</h1>
          <MeshControls />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab.value} action="directory.tab" />
      </Layout>
      <div>
        {activeTab.value === 'humans' && <HumansView />}
        {activeTab.value === 'devices' && <DevicesView />}
      </div>
    </Layout>
  );
}
