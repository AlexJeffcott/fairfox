/** @jsxImportSource preact */
// HelpView — a quick-start page for people who land on a paired
// device and want to know how the moving parts fit together. Same
// content as README.md's quick-start section, rendered for a
// browser audience.

import { Layout } from '@fairfox/polly/ui';

function Section({
  heading,
  children,
}: {
  heading: string;
  children: preact.ComponentChildren;
}): preact.JSX.Element {
  return (
    <Layout rows="auto auto" gap="var(--polly-space-sm)">
      <h2 style={{ margin: 0, fontSize: 'var(--polly-text-lg)' }}>{heading}</h2>
      <div style={{ color: 'var(--polly-text-muted)' }}>{children}</div>
    </Layout>
  );
}

function Code({ children }: { children: string }): preact.JSX.Element {
  return (
    <pre
      style={{
        margin: 'var(--polly-space-xs) 0',
        padding: 'var(--polly-space-sm) var(--polly-space-md)',
        background: 'var(--polly-surface-sunken)',
        borderRadius: 'var(--polly-radius-md)',
        overflowX: 'auto',
        fontSize: 'var(--polly-text-sm)',
        color: 'var(--polly-text)',
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

export function HelpView(): preact.JSX.Element {
  return (
    <Layout rows="auto" gap="var(--polly-space-xl)">
      <p style={{ margin: 0 }}>
        fairfox is a small household mesh. Every paired device shares the same CRDT state — todos,
        agenda, users, peers — over WebRTC. The server is only here for discovery and a one-shot
        pairing relay, not the data path. This page is a quick tour of the moving parts.
      </p>

      <Section heading="Install the CLI">
        <p>
          The CLI is a full peer — same keyring, same documents as this browser. From a fresh
          checkout of the repo:
        </p>
        <Code>{'bash scripts/install-cli-local.sh'}</Code>
        <p>
          Symlinks <code>~/.local/bin/fairfox</code> and drops a zsh completion at{' '}
          <code>~/.zfunc/_fairfox</code>. If <code>~/.local/bin</code> isn't on your PATH yet, add
          to your <code>~/.zshrc</code>:
        </p>
        <Code>
          {[
            'export PATH="$HOME/.local/bin:$PATH"',
            'fpath=($HOME/.zfunc $fpath)',
            'autoload -U compinit && compinit',
          ].join('\n')}
        </Code>
      </Section>

      <Section heading="Start a new mesh">
        <Code>
          {[
            'fairfox mesh init \\',
            '  --admin "Alex" \\',
            '  --user "Elisa:member" \\',
            '  --user "Leo:member"',
          ].join('\n')}
        </Code>
        <p>
          Creates the mesh, prints your recovery blob (save it — password manager), names the mesh
          with a line of poetry unless you pass <code>--name "…"</code>, and prepares one QR per
          invited user. Roles: <code>admin</code>, <code>member</code>, <code>guest</code>,{' '}
          <code>llm</code>.
        </p>
      </Section>

      <Section heading="Add another device for yourself">
        <Code>{'fairfox mesh add-device'}</Code>
        <p>
          Terminal QR + share URL. Scan on your phone — the URL carries a pair token and your
          recovery blob, so the phone pairs and adopts your identity in one tap. URL carries your
          secret key — share only with yourself.
        </p>
      </Section>

      <Section heading="Onboard someone else">
        <Code>{'fairfox mesh invite open elisa'}</Code>
        <p>
          Holds a live QR open until ctrl-c. Elisa scans, her browser pairs + adopts her identity.{' '}
          <code>fairfox mesh invite list</code> shows pending / consumed invites.
        </p>
      </Section>

      <Section heading="Verify two devices are on the same mesh">
        <Code>{'fairfox mesh whoami'}</Code>
        <p>
          Prints the mesh name, fingerprint, and this device's peer id. Compare the fingerprint to
          the one in this page's header — same 8 hex chars means same mesh.
        </p>
      </Section>

      <Section heading="Everyday commands">
        <Code>
          {[
            '# Todos — same data as the Todo sub-app',
            'fairfox todo tasks',
            'fairfox todo task add "Do the thing" --project P01 --priority high',
            'fairfox todo task done T1776614638630-x33y',
            '',
            '# Agenda',
            'fairfox agenda list',
            'fairfox agenda add "Take out the bins"',
            '',
            '# Users',
            'fairfox users                # everyone',
            'fairfox users whoami         # this device + effective perms',
            'fairfox users invite Leo --role member',
            '',
            '# Peers',
            'fairfox peers                # every paired device',
            'fairfox peers rename "Alex laptop"',
            '',
            '# Deploy (from the repo root)',
            'fairfox deploy',
          ].join('\n')}
        </Code>
      </Section>

      <Section heading="Files the CLI writes">
        <ul>
          <li>
            <code>~/.fairfox/keyring.json</code> — per-device Ed25519 keypair + known peers.
          </li>
          <li>
            <code>~/.fairfox/user-identity.json</code> — per-user Ed25519 keypair + display name.
            Mode 0600.
          </li>
          <li>
            <code>~/.fairfox/invites.json</code> — pending invite blobs. Mode 0600.
          </li>
          <li>
            <code>~/.fairfox/mesh/</code> — this CLI's Automerge document store. Safe to delete;
            re-syncs from any other peer.
          </li>
        </ul>
      </Section>

      <Section heading="Troubleshooting">
        <ul>
          <li>
            <strong>"This device isn't allowed to bring in new peers."</strong> Hard-reload (⇧⌘R);
            the self-heal writes the missing row on mount. If it persists, re-scan with{' '}
            <code>fairfox mesh add-device</code>.
          </li>
          <li>
            <strong>Install button not showing.</strong> Desktop Chrome needs a user engagement
            signal before <code>beforeinstallprompt</code> fires. Scroll / click / wait ~30s, then
            reload. Safari: use the share menu → "Add to Dock" / "Add to Home Screen".
          </li>
          <li>
            <strong>CLI crashes with "Cycle detected."</strong> Polly bug fixed in 0.29.3 — make
            sure <code>bun install</code> has picked it up.
          </li>
        </ul>
      </Section>
    </Layout>
  );
}
