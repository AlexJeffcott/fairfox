/** @jsxImportSource preact */
// Login page — full-screen gate the mesh shows before any sub-app
// content can render. An unpaired device isn't really "using fairfox
// with a warning banner"; it's pre-fairfox. The page walks the user
// through one of three choices: share a pairing link (this device
// issues first), consume a link they already have (this device scans
// first), or declare this device solo (first-device bootstrap, no
// peer required).
//
// The page reuses the same pairingMode wizard the earlier banner ran.
// Steps drain pairingStepsRemaining as they succeed, so either entry
// order finishes with mutual trust. A `#pair=<token>` fragment in the
// URL on mount short-circuits the idle screen and auto-submits the
// scanned token.

import { ActionInput, Button, Layout } from '@fairfox/polly/ui';
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
  displayNameDraft,
  pendingRecoveryBlob,
  recoveryBlobDraft,
  userIdentity,
  userSetupError,
} from '#src/user-identity-state.ts';
import { usersState } from '#src/users-state.ts';

const PAGE_STYLE = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--polly-space-lg)',
  background: 'var(--polly-surface-muted, #f5f5f4)',
};

const CARD_STYLE = {
  width: '100%',
  maxWidth: '460px',
  background: 'var(--polly-surface, #ffffff)',
  color: 'var(--polly-text, #1c1917)',
  padding: 'var(--polly-space-lg, 1.5rem)',
  borderRadius: '12px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)',
};

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
    <details style={{ marginTop: 'var(--polly-space-sm, 0.5rem)' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
        Pair a CLI instead of a browser
      </summary>
      <p style={{ margin: '0.25rem 0', fontSize: '0.75rem' }}>
        Paste this command into a terminal on the machine you want to pair. The installer drops
        fairfox at <code>~/.local/bin/fairfox</code> and applies the pair token in one step.
      </p>
      <code
        style={{
          display: 'block',
          wordBreak: 'break-all',
          padding: '0.5rem',
          background: 'rgba(0, 0, 0, 0.06)',
          borderRadius: '4px',
          fontSize: '0.75rem',
          marginTop: '0.25rem',
        }}
      >
        {command}
      </code>
    </details>
  );
}

function ExtensionPairReveal({ token }: { token: string }): preact.JSX.Element | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const downloadUrl = `${window.location.origin}/extension/fairfox.zip?token=${encodeURIComponent(token)}`;
  return (
    <details style={{ marginTop: 'var(--polly-space-sm, 0.5rem)' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
        Pair a Chrome extension instead
      </summary>
      <p style={{ margin: '0.25rem 0', fontSize: '0.75rem' }}>
        Download the fairfox side-panel extension with this pairing token already baked in. Unzip
        it, open <code>chrome://extensions</code>, enable Developer mode, and load the unpacked
        folder. The first time the side panel opens, fairfox pairs itself through the embedded
        frame.
      </p>
      <a
        href={downloadUrl}
        download="fairfox-extension.zip"
        style={{
          display: 'inline-block',
          marginTop: '0.25rem',
          padding: '0.4rem 0.75rem',
          borderRadius: '4px',
          fontSize: '0.8rem',
          background: 'rgba(0, 0, 0, 0.06)',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        Download extension .zip
      </a>
    </details>
  );
}

function Header(): preact.JSX.Element {
  return (
    <div style={{ textAlign: 'center', marginBottom: 'var(--polly-space-md, 1rem)' }}>
      <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem' }}>fairfox</h1>
      <p style={{ margin: 0, color: 'var(--polly-text-muted, #57534e)', fontSize: '0.95rem' }}>
        This device isn't connected to your mesh yet. Pick how you'd like to continue.
      </p>
    </div>
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
    <details style={{ marginTop: 'var(--polly-space-sm, 0.5rem)' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
        Also invite a new user with this link
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
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'var(--polly-text-muted, #57534e)',
                  fontStyle: 'italic',
                }}
              >
                Invite baked into the link above for {inviteIssuedName.value}.
              </p>
            )}
          </>
        )}
      </Layout>
    </details>
  );
}

function IssueView(): preact.JSX.Element {
  const remaining = pairingStepsRemaining.value;
  const scanPending = remaining.has('scan');
  const waiting = issuerWaitingForReturn.value;
  const doneLabel = scanPending ? 'Continue — paste their link' : "They accepted — we're done";
  return (
    <div>
      <p style={{ margin: '0 0 var(--polly-space-md, 1rem)' }}>
        Open the other device's camera on this QR, or send it the link. The receiving device takes
        the token and signs this device into the mesh.
      </p>
      {issuedQr.value ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 'var(--polly-space-md, 1rem)',
          }}
          dangerouslySetInnerHTML={{ __html: issuedQr.value }}
        />
      ) : (
        <p style={{ textAlign: 'center', fontStyle: 'italic' }}>Generating QR…</p>
      )}
      {waiting && (
        <p
          style={{
            textAlign: 'center',
            fontStyle: 'italic',
            color: 'var(--polly-text-muted, #57534e)',
            fontSize: '0.85rem',
            marginBottom: 'var(--polly-space-sm, 0.5rem)',
          }}
        >
          Waiting for the other device… (or paste their token manually below)
        </p>
      )}
      {issuedShareUrl.value && (
        <p style={{ wordBreak: 'break-all', fontSize: '0.8rem', textAlign: 'center' }}>
          <a href={issuedShareUrl.value}>{issuedShareUrl.value}</a>
        </p>
      )}
      {issuedToken.value && (
        <details style={{ marginTop: 'var(--polly-space-sm, 0.5rem)' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
            Show the raw token (for manual paste)
          </summary>
          <code
            style={{
              display: 'block',
              wordBreak: 'break-all',
              padding: '0.5rem',
              background: 'rgba(0, 0, 0, 0.06)',
              borderRadius: '4px',
              fontSize: '0.75rem',
              marginTop: '0.25rem',
            }}
          >
            {issuedToken.value}
          </code>
        </details>
      )}
      {issuedToken.value && <CliPairReveal token={issuedToken.value} />}
      {issuedToken.value && <ExtensionPairReveal token={issuedToken.value} />}
      {issuedToken.value && <InviteSection />}
      <Layout
        columns="1fr 1fr"
        gap="var(--polly-space-sm, 0.5rem)"
        padding="var(--polly-space-md, 1rem) 0 0 0"
      >
        <Button
          label={doneLabel}
          tier="primary"
          fullWidth={true}
          data-action="pairing.issue-done"
        />
        <Button label="Back" tier="tertiary" fullWidth={true} data-action="pairing.cancel" />
      </Layout>
      {pairingError.value && (
        <p style={{ color: '#b91c1c', marginTop: 'var(--polly-space-sm, 0.5rem)' }}>
          {pairingError.value}
        </p>
      )}
    </div>
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
    <div>
      <p style={{ margin: '0 0 var(--polly-space-md, 1rem)' }}>{instruction}</p>
      {cameraAvailable && (
        <Layout
          columns="1fr"
          gap="var(--polly-space-sm, 0.5rem)"
          padding="0 0 var(--polly-space-sm, 0.5rem) 0"
        >
          <Button
            label="Scan with camera"
            tier="primary"
            fullWidth={true}
            data-action="pairing.open-camera"
          />
        </Layout>
      )}
      <Layout
        columns="1fr"
        gap="var(--polly-space-sm, 0.5rem)"
        padding="0 0 var(--polly-space-sm, 0.5rem) 0"
      >
        <QrImageDropzone />
      </Layout>
      <ActionInput
        value={scanInput.value}
        variant="single"
        action="pairing.submit-scan"
        saveOn="enter"
        placeholder="…or paste token here"
      />
      <Layout
        columns="1fr"
        gap="var(--polly-space-sm, 0.5rem)"
        padding="var(--polly-space-md, 1rem) 0 0 0"
      >
        <Button label="Back" tier="tertiary" fullWidth={true} data-action="pairing.cancel" />
      </Layout>
      {pairingError.value && (
        <p style={{ color: '#b91c1c', marginTop: 'var(--polly-space-sm, 0.5rem)' }}>
          {pairingError.value}
        </p>
      )}
    </div>
  );
}

function WhoAreYouHeader(): preact.JSX.Element {
  return (
    <div style={{ textAlign: 'center', marginBottom: 'var(--polly-space-md, 1rem)' }}>
      <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem' }}>fairfox</h1>
      <p style={{ margin: 0, color: 'var(--polly-text-muted, #57534e)', fontSize: '0.95rem' }}>
        First, tell fairfox who you are. This is the identity every device you pair will act under.
      </p>
    </div>
  );
}

function WhoAreYouView(): preact.JSX.Element {
  return (
    <Layout rows="auto auto auto" gap="var(--polly-space-md, 1rem)">
      <div>
        <p
          style={{
            margin: '0 0 var(--polly-space-xs, 0.25rem)',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          New user
        </p>
        <p
          style={{
            margin: '0 0 var(--polly-space-sm, 0.5rem)',
            fontSize: '0.85rem',
            color: 'var(--polly-text-muted, #57534e)',
          }}
        >
          Pick a display name. fairfox will generate a keypair and show you a one-time recovery blob
          you can use to bring this identity onto another device later.
        </p>
        <ActionInput
          value={displayNameDraft.value}
          variant="single"
          action="users.display-name-input"
          saveOn="blur"
          placeholder="Your name"
          ariaLabel="Your display name"
        />
        <Layout
          columns="1fr"
          gap="var(--polly-space-sm, 0.5rem)"
          padding="var(--polly-space-sm, 0.5rem) 0 0 0"
        >
          <Button
            label="Create my identity"
            tier="primary"
            fullWidth={true}
            data-action="users.create-bootstrap"
          />
        </Layout>
      </div>
      <div>
        <p
          style={{
            margin: '0 0 var(--polly-space-xs, 0.25rem)',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          Existing user — import recovery blob
        </p>
        <p
          style={{
            margin: '0 0 var(--polly-space-sm, 0.5rem)',
            fontSize: '0.85rem',
            color: 'var(--polly-text-muted, #57534e)',
          }}
        >
          Already have a recovery blob from another device? Paste it here.
        </p>
        <ActionInput
          value={recoveryBlobDraft.value}
          variant="single"
          action="users.recovery-blob-input"
          saveOn="blur"
          placeholder="fairfox-user-v1:..."
          ariaLabel="Recovery blob"
        />
        <Layout
          columns="1fr"
          gap="var(--polly-space-sm, 0.5rem)"
          padding="var(--polly-space-sm, 0.5rem) 0 0 0"
        >
          <Button
            label="Import"
            tier="secondary"
            fullWidth={true}
            data-action="users.import-recovery"
          />
        </Layout>
      </div>
      {userSetupError.value && (
        <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{userSetupError.value}</p>
      )}
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
      <div>
        <p
          style={{
            margin: 0,
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          Save this recovery blob
        </p>
        <p
          style={{
            margin: '0.25rem 0 0',
            fontSize: '0.85rem',
            color: 'var(--polly-text-muted, #57534e)',
          }}
        >
          It holds your user key. Store it somewhere safe (password manager, encrypted note).
          Without it, losing every device holding this identity means losing access.
        </p>
      </div>
      <code
        style={{
          display: 'block',
          wordBreak: 'break-all',
          padding: '0.5rem',
          background: 'rgba(0, 0, 0, 0.06)',
          borderRadius: '4px',
          fontSize: '0.72rem',
        }}
      >
        {blob}
      </code>
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
      <div style={PAGE_STYLE}>
        <div style={CARD_STYLE}>
          <WhoAreYouHeader />
          <RecoveryBlobView />
          <PwaInstallPrompt />
        </div>
      </div>
    );
  }
  if (identity === null) {
    return (
      <div style={PAGE_STYLE}>
        <div style={CARD_STYLE}>
          <WhoAreYouHeader />
          <WhoAreYouView />
          <PwaInstallPrompt />
        </div>
      </div>
    );
  }
  return (
    <div style={PAGE_STYLE}>
      <div style={CARD_STYLE}>
        <Header />
        {pairingMode.value === 'idle' && <IdleChoices />}
        {pairingMode.value === 'wizard-issue' && <IssueView />}
        {pairingMode.value === 'wizard-scan' && <ScanView />}
        <PwaInstallPrompt />
      </div>
      <QrScanDialog />
    </div>
  );
}
