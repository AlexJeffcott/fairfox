/** @jsxImportSource preact */
// The fairfox home screen — visible only once the device is paired.
//
// Two tabs: Apps (the grid of sub-app cards) and Peers (the mesh-wide
// device list, rename, reconnect, forget). The Apps tab is the
// default because most visits want to launch a sub-app; the Peers tab
// is the natural home for pairing-adjacent administration since
// pairing already lives on this sub-app.

import { Layout, Tabs } from '@fairfox/polly/ui';
import { canDo } from '@fairfox/shared/policy';
import { PwaInstallPrompt } from '@fairfox/shared/pwa-install';
import { signal } from '@preact/signals';
import { PeersView } from '#src/client/PeersView.tsx';
import { UsersView } from '#src/client/UsersView.tsx';

export type HomeView = 'apps' | 'peers' | 'users';

export const activeView = signal<HomeView>('apps');

function isHomeView(v: string): v is HomeView {
  return v === 'apps' || v === 'peers' || v === 'users';
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
  { path: '/the-struggle', name: 'The Struggle', description: 'Interactive sci-fi story' },
  { path: '/library', name: 'Library', description: 'References and the world bible' },
  { path: '/speakwell', name: 'Speakwell', description: 'Spoken-skills coach' },
  { path: '/family-phone-admin', name: 'Family Phone', description: 'Directory and devices' },
];

const LEGACY: readonly SubApp[] = [
  { path: '/todo', name: '/todo', description: 'Legacy project tracker (read-only fallback)' },
  { path: '/struggle', name: '/struggle', description: 'Legacy struggle reader' },
];

function AppsGrid() {
  return (
    <Layout rows="auto auto" gap="var(--polly-space-xl)">
      <Layout rows="auto" gap="var(--polly-space-md)">
        {SUBAPPS.map((s) => (
          <a
            key={s.path}
            href={s.path}
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

      <Layout rows="auto auto" gap="var(--polly-space-sm)">
        <span
          style={{
            color: 'var(--polly-text-muted)',
            fontSize: 'var(--polly-text-sm)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Legacy
        </span>
        <Layout rows="auto" gap="var(--polly-space-xs)">
          {LEGACY.map((s) => (
            <a
              key={s.path}
              href={s.path}
              style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}
            >
              {s.name} — {s.description}
            </a>
          ))}
        </Layout>
      </Layout>
    </Layout>
  );
}

export function Home() {
  return (
    <Layout
      rows="auto auto 1fr"
      gap="var(--polly-space-xl)"
      padding="var(--polly-space-xl)"
      maxInlineSize="var(--polly-measure-page)"
    >
      <header>
        <h1>fairfox</h1>
        <p style={{ color: 'var(--polly-text-muted)' }}>A small monorepo of things.</p>
        <PwaInstallPrompt />
      </header>

      <Tabs tabs={tabList()} activeTab={activeView.value} action="home.tab" />

      <div>
        {activeView.value === 'apps' && <AppsGrid />}
        {activeView.value === 'peers' && <PeersView />}
        {activeView.value === 'users' && <UsersView />}
      </div>
    </Layout>
  );
}
