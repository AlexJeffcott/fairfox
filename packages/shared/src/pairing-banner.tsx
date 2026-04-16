/** @jsxImportSource preact */
// Pairing banner — a small cross-sub-app indicator that shows when the
// current device is not yet paired with anyone. Every sub-app renders
// this at the top so a new device always has a visible path to joining
// the mesh, regardless of which sub-app its user landed on first.
//
// The banner is a passive reader: it reads the MeshKeyring from
// IndexedDB on mount and displays if the knownPeers map is empty.
// The pairing itself happens on /family-phone-admin — the banner just
// points the user there.

import { signal, useSignalEffect } from '@preact/signals';
import { loadOrCreateKeyring } from '#src/keyring.ts';

const knownPeerCount = signal<number | null>(null);

async function refreshKeyringState(): Promise<void> {
  try {
    const keyring = await loadOrCreateKeyring();
    knownPeerCount.value = keyring.knownPeers.size;
  } catch {
    knownPeerCount.value = null;
  }
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

  const isAdmin = window.location.pathname.startsWith('/family-phone-admin');

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
      <strong>This device isn't paired yet.</strong>{' '}
      {isAdmin ? (
        <>Use the Issue token or Scan token buttons below to join the mesh.</>
      ) : (
        <>
          Open <a href="/family-phone-admin">/family-phone-admin</a> on a trusted device to issue a
          pairing token, then scan it here.
        </>
      )}
    </div>
  );
}
