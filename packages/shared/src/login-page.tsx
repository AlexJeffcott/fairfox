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
  issuedQr,
  issuedShareUrl,
  issuedToken,
  pairingError,
  pairingMode,
  pairingStepsRemaining,
  scanInput,
} from '#src/pairing-state.ts';

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

function IssueView(): preact.JSX.Element {
  const remaining = pairingStepsRemaining.value;
  const scanPending = remaining.has('scan');
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
    ? "Paste the token from the other device and press Enter. After we accept it we'll show this device's own link for them to open."
    : 'Paste the token from the other device and press Enter.';
  return (
    <div>
      <p style={{ margin: '0 0 var(--polly-space-md, 1rem)' }}>{instruction}</p>
      <ActionInput
        value={scanInput.value}
        variant="single"
        action="pairing.submit-scan"
        saveOn="enter"
        placeholder="Paste token here..."
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

export function LoginPage(): preact.JSX.Element {
  return (
    <div style={PAGE_STYLE}>
      <div style={CARD_STYLE}>
        <Header />
        {pairingMode.value === 'idle' && <IdleChoices />}
        {pairingMode.value === 'wizard-issue' && <IssueView />}
        {pairingMode.value === 'wizard-scan' && <ScanView />}
      </div>
    </div>
  );
}
