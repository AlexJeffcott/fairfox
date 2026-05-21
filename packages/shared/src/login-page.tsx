/** @jsxImportSource preact */
// Login page — full-screen gate the mesh shows before any sub-app
// content can render. An unpaired device isn't really "using fairfox
// with a warning banner"; it's pre-fairfox.
//
// Onboarding has one everyday door: Join a mesh — scan a QR or open a
// link from a device already on the mesh, which pairs this device in
// and hands it an identity. Starting a brand-new mesh is a deliberate
// CLI act (`fairfox init`) so the admin root lives in durable storage,
// not clearable browser state; the wizard just points there. A
// de-emphasised Recover path covers the break-glass case of bringing
// an existing identity onto fresh hardware.
//
// The page reuses the pairingMode wizard. Steps drain
// pairingStepsRemaining as they succeed, so the ceremony finishes with
// mutual trust. A `#pair=<token>` fragment in the URL on mount
// short-circuits the idle screen and auto-submits the scanned token.

import { ActionInput, Button, Code, Layout, Surface, Text } from '@fairfox/polly/ui';
import {
  inviteDraftEnabled,
  inviteDraftName,
  inviteDraftRole,
  inviteIssuedName,
  issuedQr,
  issuedShareUrl,
  issuedToken,
  issuerWaitingForReturn,
  pairingError,
  pairingMode,
  pairingSessionId,
  pairingStepsRemaining,
  scanInput,
} from '#src/pairing-state.ts';
import { PwaInstallPrompt } from '#src/pwa-install.tsx';
import { canScanWithCamera, QrImageDropzone, QrScanDialog } from '#src/qr-scan.tsx';
import {
  pendingRecoveryBlob,
  recoveryBlobDraft,
  userIdentity,
  userSetupError,
} from '#src/user-identity-state.ts';
import { usersState } from '#src/users-state.ts';

/** Full-viewport muted backdrop that vertically and horizontally
 * centres the login card. */
function Page({ children }: { children: preact.ComponentChildren }): preact.JSX.Element {
  return (
    <Surface background="sunken" minHeight="100vh" padding="var(--polly-space-lg)">
      <Layout autoFlow="row" justifyItems="center" alignContent="center" minHeight="100%">
        {children}
      </Layout>
    </Surface>
  );
}

/** The bounded login panel. */
function Card({ children }: { children: preact.ComponentChildren }): preact.JSX.Element {
  return (
    <Surface
      variant="raised"
      radius="lg"
      shadow="md"
      padding="var(--polly-space-lg)"
      width="100%"
      maxInlineSize="460px"
    >
      {children}
    </Surface>
  );
}

function CliPairReveal({ token }: { token: string }): preact.JSX.Element | null {
  if (typeof window === 'undefined') {
    return null;
  }
  // Include the signalling session id so the CLI can emit a
  // pair-return frame back to this tab after it applies the token.
  // Without the return, the laptop never adds the CLI's identity to
  // its keyring and every op the CLI signs gets rejected at sync,
  // leaving the CLI invisible despite the pair appearing to succeed.
  const sessionId = pairingSessionId.value;
  const params = new URLSearchParams({ token });
  if (sessionId) {
    params.set('s', sessionId);
  }
  const installUrl = `${window.location.origin}/cli/install?${params.toString()}`;
  const command = `curl -fsSL "${installUrl}" | sh`;
  return (
    <details>
      <summary>
        <Text size="sm">Pair a CLI instead of a browser</Text>
      </summary>
      <Layout rows="auto auto" gap="var(--polly-space-xs)" padding="var(--polly-space-xs) 0 0 0">
        <Text as="p" size="xs">
          Paste this command into a terminal on the machine you want to pair. The installer drops
          fairfox at <Code>~/.local/bin/fairfox</Code> and applies the pair token in one step.
        </Text>
        <Code block={true}>{command}</Code>
      </Layout>
    </details>
  );
}

function ExtensionPairReveal({ token }: { token: string }): preact.JSX.Element | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const downloadUrl = `${window.location.origin}/extension/fairfox.zip?token=${encodeURIComponent(token)}`;
  return (
    <details>
      <summary>
        <Text size="sm">Pair a Chrome extension instead</Text>
      </summary>
      <Layout rows="auto auto" gap="var(--polly-space-xs)" padding="var(--polly-space-xs) 0 0 0">
        <Text as="p" size="xs">
          Download the fairfox side-panel extension with this pairing token already baked in. Unzip
          it, open <Code>chrome://extensions</Code>, enable Developer mode, and load the unpacked
          folder. The first time the side panel opens, fairfox pairs itself through the embedded
          frame.
        </Text>
        <Layout rows="auto" justifyItems="start">
          <a href={downloadUrl} download="fairfox-extension.zip">
            <Text size="sm">Download extension .zip</Text>
          </a>
        </Layout>
      </Layout>
    </details>
  );
}

function Header(): preact.JSX.Element {
  return (
    <Layout
      rows="auto auto"
      gap="var(--polly-space-sm)"
      justifyItems="center"
      padding="0 0 var(--polly-space-md) 0"
    >
      <Text as="h1" size="xl" weight="bold">
        fairfox
      </Text>
      <Text as="p" tone="muted" size="md">
        This device isn't connected to your mesh yet. Pick how you'd like to continue.
      </Text>
    </Layout>
  );
}

function IdleChoices(): preact.JSX.Element {
  return (
    <Layout rows="auto auto auto" gap="var(--polly-space-sm, 0.5rem)">
      <Button
        label="Share a pairing link"
        tier="primary"
        fullWidth={true}
        data-action="pairing.start-issue"
      />
      <Button
        label="I have a pairing link"
        tier="secondary"
        fullWidth={true}
        data-action="pairing.start-scan"
      />
      <Button
        label="Use this device alone"
        tier="tertiary"
        fullWidth={true}
        data-action="pairing.start-solo"
      />
    </Layout>
  );
}

function canIssueInvite(): boolean {
  const identity = userIdentity.value;
  if (!identity) {
    return false;
  }
  const entry = usersState.value.users[identity.userId];
  if (!entry) {
    return false;
  }
  if (entry.revokedAt) {
    return false;
  }
  return entry.roles.includes('admin');
}

function InviteSection(): preact.JSX.Element | null {
  if (!canIssueInvite()) {
    return null;
  }
  const enabled = inviteDraftEnabled.value;
  return (
    <details>
      <summary>
        <Text size="sm">Also invite a new user with this link</Text>
      </summary>
      <Layout
        rows="auto auto auto auto"
        gap="var(--polly-space-xs, 0.25rem)"
        padding="var(--polly-space-sm, 0.5rem) 0 0 0"
      >
        <Button
          label={enabled ? 'Invite: ON' : 'Invite: OFF'}
          tier={enabled ? 'primary' : 'tertiary'}
          size="small"
          data-action="invite.toggle"
        />
        {enabled && (
          <>
            <ActionInput
              value={inviteDraftName.value}
              variant="single"
              action="invite.name-input"
              saveOn="blur"
              placeholder="Invitee's display name"
              ariaLabel="Invitee display name"
            />
            <Layout columns="auto auto auto" gap="var(--polly-space-xs, 0.25rem)">
              <Button
                label="Guest"
                tier={inviteDraftRole.value === 'guest' ? 'primary' : 'tertiary'}
                size="small"
                data-action="invite.role-input"
                data-action-value="guest"
              />
              <Button
                label="Member"
                tier={inviteDraftRole.value === 'member' ? 'primary' : 'tertiary'}
                size="small"
                data-action="invite.role-input"
                data-action-value="member"
              />
              <Button
                label="Admin"
                tier={inviteDraftRole.value === 'admin' ? 'primary' : 'tertiary'}
                size="small"
                data-action="invite.role-input"
                data-action-value="admin"
              />
            </Layout>
            {inviteIssuedName.value && (
              <Text as="p" size="xs" tone="muted">
                Invite baked into the link above for {inviteIssuedName.value}.
              </Text>
            )}
          </>
        )}
      </Layout>
    </details>
  );
}

/** Danger-coloured paragraph for pairing / setup errors. */
function ErrorText({ children }: { children: preact.ComponentChildren }): preact.JSX.Element {
  return (
    <Text as="p" size="sm" tone="danger">
      {children}
    </Text>
  );
}

function IssueView(): preact.JSX.Element {
  const remaining = pairingStepsRemaining.value;
  const scanPending = remaining.has('scan');
  const waiting = issuerWaitingForReturn.value;
  const doneLabel = scanPending ? 'Continue — paste their link' : "They accepted — we're done";
  return (
    <Layout autoFlow="row" gap="var(--polly-space-md)">
      <Text as="p">
        Open the other device's camera on this QR, or send it the link. The receiving device takes
        the token and signs this device into the mesh.
      </Text>
      {issuedQr.value ? (
        <Layout rows="auto" justifyItems="center">
          {/* QR markup is locally-generated SVG; render it into a span. */}
          <span dangerouslySetInnerHTML={{ __html: issuedQr.value }} />
        </Layout>
      ) : (
        <Layout rows="auto" justifyItems="center">
          <Text tone="muted">Generating QR…</Text>
        </Layout>
      )}
      {waiting && (
        <Layout rows="auto" justifyItems="center">
          <Text tone="muted" size="sm">
            Waiting for the other device… (or paste their token manually below)
          </Text>
        </Layout>
      )}
      {issuedShareUrl.value && (
        <Layout rows="auto" justifyItems="center">
          {/* data-polly-wrap keeps a long unbroken pairing URL from
              overflowing the card. */}
          <a href={issuedShareUrl.value} data-polly-wrap={true}>
            <Text size="sm">{issuedShareUrl.value}</Text>
          </a>
        </Layout>
      )}
      {issuedToken.value && (
        <details>
          <summary>
            <Text size="sm">Show the raw token (for manual paste)</Text>
          </summary>
          <Layout padding="var(--polly-space-xs) 0 0 0">
            <Code block={true}>{issuedToken.value}</Code>
          </Layout>
        </details>
      )}
      {issuedToken.value && <CliPairReveal token={issuedToken.value} />}
      {issuedToken.value && <ExtensionPairReveal token={issuedToken.value} />}
      {issuedToken.value && <InviteSection />}
      <Layout columns="1fr 1fr" gap="var(--polly-space-sm, 0.5rem)">
        <Button
          label={doneLabel}
          tier="primary"
          fullWidth={true}
          data-action="pairing.issue-done"
        />
        <Button label="Back" tier="tertiary" fullWidth={true} data-action="pairing.cancel" />
      </Layout>
      {pairingError.value && <ErrorText>{pairingError.value}</ErrorText>}
    </Layout>
  );
}

function ScanView(): preact.JSX.Element {
  const remaining = pairingStepsRemaining.value;
  const issuePending = remaining.has('issue');
  const instruction = issuePending
    ? "Scan the QR on the admin device with the camera button below, or paste its token and press Enter. After we accept it we'll show this device's own link for them to open."
    : 'Scan the QR on the admin device with the camera button below, or paste its token and press Enter.';
  const cameraAvailable = canScanWithCamera();
  return (
    <Layout autoFlow="row" gap="var(--polly-space-md)">
      <Text as="p">{instruction}</Text>
      {cameraAvailable && (
        <Button
          label="Scan with camera"
          tier="primary"
          fullWidth={true}
          data-action="pairing.open-camera"
        />
      )}
      <QrImageDropzone />
      <ActionInput
        value={scanInput.value}
        variant="single"
        action="pairing.submit-scan"
        saveOn="enter"
        placeholder="…or paste token here"
      />
      <Button label="Back" tier="tertiary" fullWidth={true} data-action="pairing.cancel" />
      {pairingError.value && <ErrorText>{pairingError.value}</ErrorText>}
    </Layout>
  );
}

function WhoAreYouHeader(): preact.JSX.Element {
  return (
    <Layout
      rows="auto auto"
      gap="var(--polly-space-sm)"
      justifyItems="center"
      padding="0 0 var(--polly-space-md) 0"
    >
      <Text as="h1" size="xl" weight="bold">
        fairfox
      </Text>
      <Text as="p" tone="muted" size="md">
        This device isn't on a mesh yet. Join one to get started.
      </Text>
    </Layout>
  );
}

/** A small bold section heading inside the WhoAreYou wizard. */
function SectionHeading({ children }: { children: preact.ComponentChildren }): preact.JSX.Element {
  return (
    <Text as="p" size="sm" weight="bold">
      {children}
    </Text>
  );
}

/** Muted body copy for a WhoAreYou wizard section. */
function SectionBody({ children }: { children: preact.ComponentChildren }): preact.JSX.Element {
  return (
    <Text as="p" size="sm" tone="muted">
      {children}
    </Text>
  );
}

// The onboarding wizard for an unpaired device. Two doors: Join a mesh
// (the everyday path — scan a QR or open a link from a device already
// on the mesh) and, de-emphasised, Recover (break-glass: bring an
// existing identity onto this device when no device of yours survives).
// Starting a brand-new mesh is a CLI-only act (`fairfox init`) so the
// admin root always lives in durable storage — the wizard just points
// there.
function WhoAreYouView(): preact.JSX.Element {
  return (
    <Layout rows="auto auto auto auto" gap="var(--polly-space-md, 1rem)">
      <Layout autoFlow="row" gap="var(--polly-space-xs)">
        <SectionHeading>Join a mesh</SectionHeading>
        <SectionBody>
          Scan the QR or open the join link from a device that's already on the mesh. This device
          pairs in and picks up its identity automatically.
        </SectionBody>
        <Layout padding="var(--polly-space-xs) 0 0 0">
          <Button
            label="Join a mesh"
            tier="primary"
            fullWidth={true}
            data-action="pairing.start-scan"
          />
        </Layout>
      </Layout>

      <Layout rows="auto" justifyItems="center">
        <SectionBody>
          Starting fresh? Run <Code>fairfox init</Code> on a computer to create a new mesh, then
          come back here and join it.
        </SectionBody>
      </Layout>

      <details>
        <summary>
          <Text size="sm" tone="muted">
            Used this identity before? Recover it
          </Text>
        </summary>
        <Layout autoFlow="row" gap="var(--polly-space-sm)" padding="var(--polly-space-sm) 0 0 0">
          <SectionBody>
            Bring an existing identity onto this device with its recovery blob — scan the QR, drop
            in a screenshot, or paste the blob as text.
          </SectionBody>
          {canScanWithCamera() && (
            <Button
              label="Scan with camera"
              tier="secondary"
              fullWidth={true}
              data-action="users.open-recovery-camera"
            />
          )}
          <QrImageDropzone mode="recovery" />
          <ActionInput
            value={recoveryBlobDraft.value}
            variant="single"
            action="users.recovery-blob-input"
            saveOn="blur"
            placeholder="…or paste fairfox-user-v1:…"
            ariaLabel="Recovery blob"
          />
          <Button
            label="Recover"
            tier="secondary"
            fullWidth={true}
            data-action="users.import-recovery"
          />
        </Layout>
      </details>

      {userSetupError.value && <ErrorText>{userSetupError.value}</ErrorText>}
    </Layout>
  );
}

function RecoveryBlobView(): preact.JSX.Element | null {
  const blob = pendingRecoveryBlob.value;
  if (!blob) {
    return null;
  }
  return (
    <Layout rows="auto auto auto auto" gap="var(--polly-space-sm, 0.5rem)">
      <Layout autoFlow="row" gap="var(--polly-space-xs)">
        <Text as="p" size="sm" weight="bold">
          Save this recovery blob
        </Text>
        <Text as="p" size="sm" tone="muted">
          It holds your user key. Store it somewhere safe (password manager, encrypted note).
          Without it, losing every device holding this identity means losing access.
        </Text>
      </Layout>
      <Code block={true}>{blob}</Code>
      <Button
        label="I've saved it — continue"
        tier="primary"
        fullWidth={true}
        data-action="users.dismiss-recovery-blob"
      />
    </Layout>
  );
}

export function LoginPage(): preact.JSX.Element {
  // The user identity gate runs before the pairing gate: without an
  // identity there's nothing to sign a pairing endorsement with.
  // `userIdentity.value === undefined` means the IDB load is still
  // in flight — render nothing to avoid a flash of WhoAreYou that
  // vanishes once IDB resolves.
  const identity = userIdentity.value;
  if (identity === undefined) {
    return <div />;
  }
  if (pendingRecoveryBlob.value) {
    return (
      <Page>
        <Card>
          <WhoAreYouHeader />
          <RecoveryBlobView />
          <PwaInstallPrompt />
        </Card>
      </Page>
    );
  }
  if (identity === null) {
    return (
      <Page>
        <Card>
          <WhoAreYouHeader />
          {pairingMode.value === 'wizard-scan' ? <ScanView /> : <WhoAreYouView />}
          <PwaInstallPrompt />
        </Card>
        <QrScanDialog />
      </Page>
    );
  }
  return (
    <Page>
      <Card>
        <Header />
        {pairingMode.value === 'idle' && <IdleChoices />}
        {pairingMode.value === 'wizard-issue' && <IssueView />}
        {pairingMode.value === 'wizard-scan' && <ScanView />}
        <PwaInstallPrompt />
      </Card>
      <QrScanDialog />
    </Page>
  );
}
