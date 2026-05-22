/** @jsxImportSource preact */
// The fairfox home screen — visible only once the device is paired.
//
// Two tabs: Apps (the grid of sub-app cards) and Peers (the mesh-wide
// device list, rename, reconnect, forget). The Apps tab is the
// default because most visits want to launch a sub-app; the Peers tab
// is the natural home for pairing-adjacent administration since
// pairing already lives on this sub-app.

import { Button, Cluster, Layout, Surface, Tabs, Text } from '@fairfox/polly/ui';
import { ensureMeshFingerprintLoaded, meshMetaState } from '@fairfox/shared/mesh-meta-state';
import { setPageContext } from '@fairfox/shared/page-context';
import { canDo } from '@fairfox/shared/policy';
import { PwaInstallPrompt } from '@fairfox/shared/pwa-install';
import { effect, signal } from '@preact/signals';
import { HelpView } from '#src/client/HelpView.tsx';
import { PeersView } from '#src/client/PeersView.tsx';
import { UsersView } from '#src/client/UsersView.tsx';

export type HomeView = 'apps' | 'peers' | 'users' | 'help';

export const activeView = signal<HomeView>('apps');

function isHomeView(v: string): v is HomeView {
  return v === 'apps' || v === 'peers' || v === 'users' || v === 'help';
}

export function setActiveView(v: string): void {
  if (isHomeView(v)) {
    activeView.value = v;
  }
}

function tabList(): { id: string; label: string }[] {
  const tabs = [
    { id: 'apps', label: 'Apps' },
    { id: 'peers', label: 'Peers' },
  ];
  // Users tab is admin-only — no point in every household seeing a
  // roster of identities they can't act on. The gate is any of the
  // user.* permissions since a member with the "user.invite" grant
  // still benefits from seeing who's there.
  if (canDo('user.invite') || canDo('user.revoke') || canDo('user.grant-role')) {
    tabs.push({ id: 'users', label: 'Users' });
  }
  tabs.push({ id: 'help', label: 'Help' });
  return tabs;
}

interface SubApp {
  readonly path: string;
  readonly name: string;
  readonly description: string;
}

const SUBAPPS: readonly SubApp[] = [
  { path: '/todo-v2', name: 'Todo', description: 'Project tracker and tasks' },
  { path: '/agenda', name: 'Agenda', description: "Household today and who's done what" },
  {
    path: '/chat',
    name: 'Chat history',
    description: 'Past chats — the live assistant is the widget, bottom-right',
  },
  { path: '/docs', name: 'Docs', description: 'Research notes and project writeups' },
  { path: '/the-struggle', name: 'The Struggle', description: 'Interactive sci-fi story' },
  { path: '/library', name: 'Library', description: 'References and the world bible' },
  { path: '/speakwell', name: 'Speakwell', description: 'Spoken-skills coach' },
  { path: '/family-phone-admin', name: 'Family Phone', description: 'Directory and devices' },
];

function AppsGrid() {
  return (
    <Layout rows="auto" gap="var(--polly-space-md)">
      {SUBAPPS.map((s) => (
        <a key={s.path} href={s.path} data-action="app.navigate" data-action-href={s.path}>
          <Surface
            variant="raised"
            padding="var(--polly-space-md) var(--polly-space-lg)"
            radius="lg"
            border="default"
          >
            <Layout rows="auto auto" gap="var(--polly-space-xs)">
              <Text as="strong" weight="bold">
                {s.name}
              </Text>
              <Text as="span" tone="muted" size="sm">
                {s.description}
              </Text>
            </Layout>
          </Surface>
        </a>
      ))}
    </Layout>
  );
}

let homeEffectsInstalled = false;

/** Drive the Home view's fingerprint load and page-context publish.
 * Previously useSignalEffect calls inside Home. */
export function installHomeEffects(): void {
  if (homeEffectsInstalled) {
    return;
  }
  homeEffectsInstalled = true;
  effect(() => {
    void ensureMeshFingerprintLoaded();
  });
  effect(() => {
    setPageContext({ kind: 'hub', label: `Hub · ${activeView.value}` });
  });
}

export function Home() {
  const meshName = meshMetaState.value.name;
  return (
    <Layout
      rows="auto auto 1fr"
      gap="var(--polly-space-xl)"
      padding="var(--polly-space-xl)"
      maxInlineSize="var(--polly-measure-page)"
    >
      <Surface as="header" background="transparent" padding="0">
        <Layout columns="1fr auto" gap="var(--polly-space-md)" alignItems="center">
          <Cluster as="h1" gap="var(--polly-space-sm)" align="baseline">
            <Text as="span">fairfox</Text>
            {meshName && (
              <Text as="span" tone="muted" size="md" weight="normal">
                · {meshName}
              </Text>
            )}
          </Cluster>
          <Layout columns="auto auto" gap="var(--polly-space-xs)" alignItems="center">
            <Button
              label="Reload"
              tier="tertiary"
              size="small"
              data-action="app.reload"
              title="Re-fetch the latest bundle and re-run the boot-time trust harvest. PWAs don't have a refresh gesture; this button replaces one."
            />
            <Button
              label="Reset"
              tier="tertiary"
              size="small"
              color="danger"
              data-action="app.reset-local"
              title="Clear this device's IndexedDB (mesh docs, keyring, user identity) and reload. Use when the PWA is stuck on a broken sync message or corrupted state. You'll need to re-pair afterwards."
            />
          </Layout>
        </Layout>
        <PwaInstallPrompt />
      </Surface>

      <Tabs tabs={tabList()} activeTab={activeView.value} action="home.tab" />

      <Surface as="section" background="transparent" padding="0">
        {activeView.value === 'apps' && <AppsGrid />}
        {activeView.value === 'peers' && <PeersView />}
        {activeView.value === 'users' && <UsersView />}
        {activeView.value === 'help' && <HelpView />}
      </Surface>
    </Layout>
  );
}
