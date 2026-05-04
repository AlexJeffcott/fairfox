/** @jsxImportSource preact */
// HelpView — a quick-start page for people who land on a paired
// device and want to know how the moving parts fit together. Same
// content as README.md's quick-start section, rendered for a
// browser audience.

import { Layout } from '@fairfox/polly/ui';
import { devicesState } from '@fairfox/shared/devices-state';
import {
  lastSignalingErrorMessage,
  signalingConnected,
} from '@fairfox/shared/mesh-connection-state';
import { meshFingerprintText, meshMetaState } from '@fairfox/shared/mesh-meta-state';
import { peersPresent } from '@fairfox/shared/peers-presence';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import { usersState } from '@fairfox/shared/users-state';
import { selfPeerId } from '#src/client/self-peer.ts';

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

function readBundleHash(): string {
  if (typeof document === 'undefined') {
    return '(no document)';
  }
  const meta = document.querySelector('meta[name="fairfox-build-hash"]');
  return meta?.getAttribute('content') ?? '(no meta tag)';
}

function countOnlinePeers(): number {
  const set = peersPresent.value;
  const self = selfPeerId.value;
  let count = 0;
  for (const id of set) {
    if (id !== self) {
      count += 1;
    }
  }
  return count;
}

function buildDiagnosticsText(): string {
  const meshName = meshMetaState.value.name || '(unnamed)';
  const fp = meshFingerprintText.value || '(loading)';
  const peerId = selfPeerId.value ?? '(loading)';
  const identity = userIdentity.value;
  const userId = identity ? identity.userId : '(no user identity)';
  const displayName = identity?.displayName ?? '(no display name)';
  const buildHash = readBundleHash();
  const sigConnected = signalingConnected.value ? 'connected' : 'disconnected';
  const sigError = lastSignalingErrorMessage.value;
  const peersOnline = countOnlinePeers();
  const totalDevices = Object.keys(devicesState.value.devices).length;
  const totalUsers = Object.keys(usersState.value.users).length;
  const userAgent = typeof navigator === 'undefined' ? '(no navigator)' : navigator.userAgent;
  const origin = typeof window === 'undefined' ? '(no window)' : window.location.origin;

  // Plain key: value pairs so the textarea contents read like a
  // chat/email-friendly diagnostic dump. Mirrors the layout of
  // `fairfox doctor` so an issue report can paste this verbatim and
  // the on-call eye recognises every field.
  const lines: readonly string[] = [
    `mesh:           ${meshName} (${fp})`,
    `user:           ${displayName} (${userId})`,
    `device peerId:  ${peerId}`,
    `paired devices: ${totalDevices}`,
    `users:          ${totalUsers}`,
    `peers online:   ${peersOnline}`,
    `signalling:     ${sigConnected}${sigError ? ` (last error: ${sigError})` : ''}`,
    `build hash:     ${buildHash}`,
    `origin:         ${origin}`,
    `user-agent:     ${userAgent}`,
  ];
  return lines.join('\n');
}

/** A read-only textarea showing every non-secret state useful for
 * "is this device on the right mesh / build / signalling pool?".
 * Tapping the textarea fires `help.select-all-textarea` which marks
 * the whole content selected so the OS copy gesture lands the lot
 * — important on a mobile PWA where multi-select is fiddly. */
function Diagnostics(): preact.JSX.Element {
  const text = buildDiagnosticsText();
  const lineCount = text.split('\n').length;
  return (
    <Layout rows="auto auto" gap="var(--polly-space-sm)">
      <h2 style={{ margin: 0, fontSize: 'var(--polly-text-lg)' }}>Diagnostics</h2>
      <p style={{ color: 'var(--polly-text-muted)', margin: 0 }}>
        Tap the box to select everything for copy. Compare with another paired device's Help tab to
        confirm you're on the same mesh.
      </p>
      <textarea
        readOnly={true}
        rows={lineCount}
        value={text}
        data-action="help.select-all-textarea"
        style={{
          width: '100%',
          fontFamily: 'var(--polly-font-mono)',
          fontSize: 'var(--polly-text-sm)',
          padding: 'var(--polly-space-sm) var(--polly-space-md)',
          background: 'var(--polly-surface-sunken)',
          borderRadius: 'var(--polly-radius-md)',
          border: '1px solid var(--polly-border)',
          color: 'var(--polly-text)',
          resize: 'none',
          whiteSpace: 'pre',
          overflow: 'auto',
        }}
      />
    </Layout>
  );
}

export function HelpView(): preact.JSX.Element {
  return (
    <Layout rows="auto" gap="var(--polly-space-xl)">
      <Diagnostics />
      <p style={{ margin: 0 }}>
        fairfox is a small household mesh. Every paired device shares the same CRDT state — todos,
        agenda, users, peers — over WebRTC. The server is only here for discovery and a one-shot
        pairing relay, not the data path. This page is a quick tour of the moving parts.
      </p>

      <Section heading="Install fairfox as an app">
        <p>
          <strong>Desktop Chrome / Edge:</strong> when the browser decides the site qualifies, it
          fires <code>beforeinstallprompt</code> and an "Install fairfox" button appears under this
          header. A first visit may not fire it — scroll, click, wait ~30s, or reload once to nudge
          it.
        </p>
        <p>
          <strong>Safari on macOS or iOS:</strong> Chromium's install event doesn't fire in Safari.
          Install via the share menu instead:
        </p>
        <ol>
          <li>Open Safari (not Chrome — iOS only lets Safari install PWAs).</li>
          <li>
            Tap the Share button (<span aria-hidden="true">⬆</span>) in the toolbar.
          </li>
          <li>
            Scroll down in the share sheet and tap "Add to Home Screen" (iOS) or "Add to Dock"
            (macOS).
          </li>
          <li>Name it, tap Add.</li>
        </ol>
        <p>
          Launching from the home-screen icon opens fairfox in standalone PWA mode, no browser
          chrome. The <strong>Reload</strong> button in this page's header substitutes for the
          refresh gesture you lose in that mode.
        </p>
      </Section>

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
            'fairfox init "Holm household" \\',
            '  --admin "Alex" \\',
            '  --user "Elisa:member" \\',
            '  --user "Leo:member"',
          ].join('\n')}
        </Code>
        <p>
          Creates the mesh, prints your recovery blob (save it — password manager), names the mesh
          from the first positional argument, and queues one invite blob per <code>--user</code>.
          Roles: <code>admin</code>, <code>member</code>, <code>guest</code>, <code>llm</code>.
        </p>
      </Section>

      <Section heading="Add another device for yourself">
        <Code>{'fairfox add device'}</Code>
        <p>
          Terminal QR + share URL. Scan on your phone — the URL carries a pair token and your
          recovery blob, so the phone pairs and adopts your identity in one tap. The URL carries
          your secret key — share only with yourself.
        </p>
      </Section>

      <Section heading="Onboard someone else">
        <Code>{'fairfox add user elisa --role member'}</Code>
        <p>
          One verb. Mints a fresh invite blob (or reopens an existing one with the same name),
          writes the invitee's UserEntry into <code>mesh:users</code>, and holds a live QR open
          until they scan or you ctrl-c. <code>fairfox invites</code> shows pending and consumed
          invites; pass <code>--queue-only</code> if you want to mint without opening the socket.
        </p>
        <p>
          The invitee has three ways to feed the QR into their already-installed PWA, all behind{' '}
          <strong>"I have a pairing link" → "Paste token"</strong>: tap <em>Scan with camera</em> to
          open an in-app camera (the OS camera would otherwise launch the default browser, not the
          PWA), click the dashed <em>Scan from a screenshot</em> zone to pick an image file, or just
          Cmd/Ctrl-V an image that's already on the clipboard. All three feed the same decode
          pipeline as the text paste box.
        </p>
      </Section>

      <Section heading="Receive a pair token, share URL, or recovery blob">
        <Code>{'fairfox pair <token-or-url-or-blob>'}</Code>
        <p>
          The receiving side of every onboarding flow — sniffs the input and routes to the right
          handler. Use this on a fresh CLI install with a share URL someone else generated, or with
          a recovery blob to reclaim your identity.
        </p>
      </Section>

      <Section heading="Verify two devices are on the same mesh">
        <Code>{'fairfox fingerprint'}</Code>
        <p>
          Prints the 8-hex mesh fingerprint — same value the Diagnostics panel above shows. Two
          devices on the same mesh print the same line; a different mesh prints a different one.
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
            '# Identity',
            'fairfox whoami                       # this device + effective perms',
            'fairfox users                        # everyone in the mesh',
            'fairfox add user Leo --role member   # invite a new user',
            '',
            '# Peers + devices',
            'fairfox peers                        # every paired device',
            'fairfox rename "Alex laptop"         # rename this device',
            'fairfox forget <peerId>              # stop syncing with a peer (local)',
            '',
            '# Universal flags on every command',
            'fairfox <command> --help             # detailed help',
            'fairfox <command> --verbose          # debug output to stderr',
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
