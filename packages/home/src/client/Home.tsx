/** @jsxImportSource preact */
// The fairfox home screen — visible only once the device is paired.
//
// One grid of cards, each pointing at a sub-app. The goal is visible
// nav, not decoration; sub-apps own their own look. Layout dictates
// the rhythm, tokens drive the colour.

import { Layout } from '@fairfox/polly/ui';
import { PwaInstallPrompt } from '@fairfox/shared/pwa-install';

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
              style={{
                color: 'var(--polly-text-muted)',
                fontSize: 'var(--polly-text-sm)',
              }}
            >
              {s.name} — {s.description}
            </a>
          ))}
        </Layout>
      </Layout>
    </Layout>
  );
}
