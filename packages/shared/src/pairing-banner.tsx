/** @jsxImportSource preact */
// Pairing banner — a cross-sub-app indicator and pairing surface. When
// the current device has no paired peers, every sub-app renders this at
// the top so a new device always has a visible path to joining the mesh.
// Clicking "Issue pairing token" or "Scan a token" expands the banner
// inline with the full pairing ceremony: no navigation away from the
// sub-app the user came to use.
//
// The banner reads the keyring on mount to decide whether to appear.
// While pairing runs, the inline panel swaps between the issued-token
// display and the scan-token input. When pairing completes the banner
// hides itself (the keyring gains a peer, triggering the re-check).

import { Button, Input } from '@fairfox/ui';
import { useSignalEffect } from '@preact/signals';
import { signal } from '@preact/signals';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { issuedToken, pairingError, pairingMode, scanInput } from '#src/pairing-state.ts';

const knownPeerCount = signal<number | null>(null);

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
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        justifyContent: 'center',
        marginTop: '0.5rem',
      }}
    >
      <Button label="Issue pairing token" tier="primary" data-action="pairing.issue" />
      <Button label="Scan a token" tier="secondary" data-action="pairing.scan" />
    </div>
  );
}

function IssuingPanel(): preact.JSX.Element {
  return (
    <div style={{ marginTop: '0.5rem', textAlign: 'left' }}>
      <p style={{ margin: '0 0 0.5rem' }}>
        <strong>Show this token to the new device.</strong> It expires in ten minutes.
      </p>
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
      <Button label="Done" tier="tertiary" data-action="pairing.cancel" />
    </div>
  );
}

function ScanningPanel(): preact.JSX.Element {
  return (
    <div style={{ marginTop: '0.5rem', textAlign: 'left' }}>
      <p style={{ margin: '0 0 0.5rem' }}>
        Paste the pairing token from the trusted device, then press Enter.
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
      {pairingMode.value === 'issuing' && <IssuingPanel />}
      {pairingMode.value === 'scanning' && <ScanningPanel />}
    </div>
  );
}
