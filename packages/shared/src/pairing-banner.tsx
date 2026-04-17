/** @jsxImportSource preact */
// Pairing banner — a cross-sub-app indicator and pairing surface. When
// the current device has no paired peers, every sub-app renders this at
// the top so a new device always has a visible path to joining the mesh.
//
// The banner walks the user through a two-step wizard because polly's
// pairing is asymmetric: a token only carries the issuer's identity, so
// each device has to both issue and scan to end up with mutual trust.
// Step 1 shows this device's token for the other device to scan; Step 2
// reads the token from the other device. When the second step completes
// the keyring gains a peer, knownPeerCount rises above zero, and the
// banner hides.

import { Button, Input } from '@fairfox/ui';
import { useSignalEffect } from '@preact/signals';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import {
  issuedToken,
  knownPeerCount,
  pairingError,
  pairingMode,
  scanInput,
} from '#src/pairing-state.ts';

async function refreshKeyringState(): Promise<void> {
  try {
    const keyring = await loadOrCreateKeyring();
    knownPeerCount.value = keyring.knownPeers.size;
  } catch {
    knownPeerCount.value = null;
  }
}

function IdlePanel(): preact.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
      <Button label="Start pairing" tier="primary" data-action="pairing.start" />
    </div>
  );
}

function IssuePanel(): preact.JSX.Element {
  return (
    <div style={{ marginTop: '0.5rem', textAlign: 'left' }}>
      <p style={{ margin: '0 0 0.5rem' }}>
        <strong>Step 1 of 2.</strong> On the other device, open any fairfox sub-app, click
        <em> Start pairing</em>, and advance to Step 2. Then paste this token into its Step 2 input
        and press Enter.
      </p>
      {issuedToken.value ? (
        <code
          style={{
            display: 'block',
            wordBreak: 'break-all',
            padding: '0.5rem',
            background: 'rgba(0, 0, 0, 0.08)',
            borderRadius: '4px',
            fontSize: '0.75rem',
            marginBottom: '0.5rem',
          }}
        >
          {issuedToken.value}
        </code>
      ) : (
        <p style={{ margin: '0 0 0.5rem', fontStyle: 'italic' }}>Generating token…</p>
      )}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button
          label="I've shared it — continue to Step 2"
          tier="primary"
          data-action="pairing.next"
        />
        <Button label="Cancel" tier="tertiary" data-action="pairing.cancel" />
      </div>
      {pairingError.value && (
        <p style={{ color: '#b91c1c', marginTop: '0.5rem' }}>{pairingError.value}</p>
      )}
    </div>
  );
}

function ScanPanel(): preact.JSX.Element {
  return (
    <div style={{ marginTop: '0.5rem', textAlign: 'left' }}>
      <p style={{ margin: '0 0 0.5rem' }}>
        <strong>Step 2 of 2.</strong> Paste the token from the other device and press Enter.
      </p>
      <Input
        value={scanInput.value}
        variant="single"
        action="pairing.submit-scan"
        saveOn="enter"
        placeholder="Paste token here..."
        markdown={false}
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <Button label="Cancel" tier="tertiary" data-action="pairing.cancel" />
      </div>
      {pairingError.value && (
        <p style={{ color: '#b91c1c', marginTop: '0.5rem' }}>{pairingError.value}</p>
      )}
    </div>
  );
}

export function PairingBanner(): preact.JSX.Element | null {
  useSignalEffect(() => {
    if (knownPeerCount.value === null) {
      void refreshKeyringState();
    }
  });

  if (knownPeerCount.value === null || knownPeerCount.value > 0) {
    return null;
  }

  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        background: '#fef3c7',
        color: '#713f12',
        borderBottom: '1px solid #fcd34d',
        fontSize: '0.875rem',
        textAlign: 'center',
      }}
    >
      <strong>This device isn't paired yet.</strong> Pair it with another device to sync your data.
      {pairingMode.value === 'idle' && <IdlePanel />}
      {pairingMode.value === 'wizard-issue' && <IssuePanel />}
      {pairingMode.value === 'wizard-scan' && <ScanPanel />}
    </div>
  );
}
