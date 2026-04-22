/** @jsxImportSource preact */
// The fairfox home screen — visible only once the device is paired.
//
// Two tabs: Apps (the grid of sub-app cards) and Peers (the mesh-wide
// device list, rename, reconnect, forget). The Apps tab is the
// default because most visits want to launch a sub-app; the Peers tab
// is the natural home for pairing-adjacent administration since
// pairing already lives on this sub-app.

import { Button, Layout, Tabs } from '@fairfox/polly/ui';
import { meshFingerprint, meshMetaState } from '@fairfox/shared/mesh-meta-state';
import { canDo } from '@fairfox/shared/policy';
import { PwaInstallPrompt } from '@fairfox/shared/pwa-install';
import { signal, useSignalEffect } from '@preact/signals';
import { HelpView } from '#src/client/HelpView.tsx';
import { PeersView } from '#src/client/PeersView.tsx';
import { selfPeerId } from '#src/client/self-peer.ts';
import { UsersView } from '#src/client/UsersView.tsx';

const meshFingerprintText = signal<string>('');

async function loadFingerprint(): Promise<void> {
  if (meshFingerprintText.value !== '') {
    return;
  }
  try {
    const { loadOrCreateKeyring } = await import('@fairfox/shared/keyring');
    const { DEFAULT_MESH_KEY_ID } = await import('@fairfox/polly/mesh');
    const keyring = await loadOrCreateKeyring();
    const docKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
    if (docKey) {
      meshFingerprintText.value = await meshFingerprint(docKey);
    }
  } catch {
    // Leave empty; the header just hides the fingerprint.
  }
}

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
    description: 'Past conversations — the live assistant is the widget, bottom-right',
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
        <a
          key={s.path}
          href={s.path}
          data-action="app.navigate"
          data-action-href={s.path}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 'var(--polly-space-xs)',
            padding: 'var(--polly-space-md) var(--polly-space-lg)',
            border: '1px solid var(--polly-border)',
            borderRadius: 'var(--polly-radius-lg)',
            textDecoration: 'none',
            color: 'var(--polly-text)',
            background: 'var(--polly-surface)',
          }}
        >
          <strong>{s.name}</strong>
          <span style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
            {s.description}
          </span>
        </a>
      ))}
    </Layout>
  );
}

export function Home() {
  useSignalEffect(() => {
    void loadFingerprint();
  });
  const meshName = meshMetaState.value.name;
  const fp = meshFingerprintText.value;
  const devId = selfPeerId.value;
  return (
    <Layout
      rows="auto auto 1fr"
      gap="var(--polly-space-xl)"
      padding="var(--polly-space-xl)"
      maxInlineSize="var(--polly-measure-page)"
    >
      <header>
        <Layout columns="1fr auto" gap="var(--polly-space-md)" alignItems="center">
          <div>
            <h1 style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--polly-space-sm)' }}>
              <span>fairfox</span>
              {meshName && (
                <span style={{ color: 'var(--polly-text-muted)', fontSize: '1rem' }}>
                  · {meshName}
                </span>
              )}
            </h1>
            <p style={{ color: 'var(--polly-text-muted)' }}>
              A small monorepo of things.
              {fp && (
                <>
                  {' '}
                  <span
                    style={{
                      fontFamily: 'var(--polly-font-mono)',
                      fontSize: 'var(--polly-text-sm)',
                    }}
                    title="Mesh fingerprint — first 8 hex of SHA-256 over the document key. Two devices on the same mesh share this value."
                  >
                    ({fp})
                  </span>
                </>
              )}
              {devId && (
                <>
                  {' · '}
                  <span
                    style={{
                      fontFamily: 'var(--polly-font-mono)',
                      fontSize: 'var(--polly-text-sm)',
                    }}
                    title="This device's peer id — unique to this browser profile / CLI install. Match against a row in the Peers tab to identify which device you're on."
                  >
                    device {devId}
                  </span>
                </>
              )}
            </p>
          </div>
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
      </header>

      <Tabs tabs={tabList()} activeTab={activeView.value} action="home.tab" />

      <div>
        {activeView.value === 'apps' && <AppsGrid />}
        {activeView.value === 'peers' && <PeersView />}
        {activeView.value === 'users' && <UsersView />}
        {activeView.value === 'help' && <HelpView />}
      </div>
    </Layout>
  );
}
