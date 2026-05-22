/** @jsxImportSource preact */
// Family-phone admin UI — two views: Humans and Devices. Pairing is
// gated by @fairfox/shared/mesh-gate at boot, so this file never has
// to render the login surface itself.

import { ActionInput, Badge, Button, Layout, Tabs, Text } from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { directoryState, familyPhoneActiveTab } from '#src/client/state.ts';

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
            columns="minmax(0, 1fr) auto auto"
            gap="var(--polly-space-sm)"
            alignItems="center"
          >
            <Text as="strong" weight="bold" data-polly-truncate={true}>
              {h.name}
            </Text>
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
        <Text as="p" tone="muted">
          No family members yet.
        </Text>
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
          <Text as="h3" size="lg" weight="bold">
            Active ({active.length})
          </Text>
          {active.map((d) => (
            <Layout
              key={d.id}
              columns="auto minmax(0, 1fr) auto auto"
              gap="var(--polly-space-sm)"
              alignItems="center"
            >
              <Badge variant="info">{d.kind}</Badge>
              <Layout rows="auto auto" gap="0">
                <Text as="strong" weight="bold" data-polly-clamp={true}>
                  {d.name}
                </Text>
                <Text as="span" size="xs" tone="muted">
                  {humansById.get(d.humanId) ?? 'unknown'} · paired{' '}
                  {new Date(d.pairedAt).toLocaleDateString()}
                </Text>
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
          <Text as="h3" size="lg" weight="bold">
            Revoked ({revoked.length})
          </Text>
          {revoked.map((d) => (
            <Layout key={d.id} columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
              <Text as="span" tone="muted" data-polly-clamp={true}>
                {d.name} · {humansById.get(d.humanId) ?? 'unknown'}
              </Text>
              <Badge variant="danger">revoked</Badge>
            </Layout>
          ))}
        </Layout>
      )}
      {directoryState.value.devices.length === 0 && (
        <Text as="p" tone="muted">
          No devices yet.
        </Text>
      )}
    </Layout>
  );
}

export function App() {
  const activeTab = familyPhoneActiveTab.value;

  return (
    <Layout rows="auto 1fr" gap="var(--polly-space-lg)" padding="var(--polly-space-lg)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        <Layout columns="1fr auto" gap="var(--polly-space-sm)">
          <Text as="h1" size="xl" weight="bold" data-polly-clamp={true}>
            Family Phone — Admin
          </Text>
          <HubBack />
        </Layout>
        <Tabs tabs={TAB_LIST} activeTab={activeTab} action="directory.tab" />
      </Layout>
      <Layout>
        {activeTab === 'humans' && <HumansView />}
        {activeTab === 'devices' && <DevicesView />}
      </Layout>
    </Layout>
  );
}
