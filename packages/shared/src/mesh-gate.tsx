/** @jsxImportSource preact */
// MeshGate — wraps a sub-app's root render and withholds its children
// until the device satisfies the gate. The gate opens when two things
// are true at once: the device is either paired (keyring has a peer)
// or explicitly solo, and no pairing ceremony is currently in flight
// (pairingMode === 'idle'). The second clause is what keeps the login
// page visible while the receiving side of a link-driven pairing is
// still generating its own return QR — otherwise applyScannedToken
// bumps knownPeerCount past zero the instant the scan completes and
// the wizard's second leg unmounts mid-animation.
//
// The wrapper also consumes a `#pair=<token>` URL fragment if present
// on first mount, regardless of current gate state. An already-paired
// device that is asked to pair with a third device therefore accepts
// the incoming token through the same URL mechanism as a fresh one.
//
// While the keyring IndexedDB read is in flight the wrapper renders
// nothing. Only once knownPeerCount settles does it route between
// <LoginPage /> and the wrapped children.

import { useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { LoginPage } from '#src/login-page.tsx';
import { consumePairingHash } from '#src/pairing-actions.ts';
import {
  hydrateSoloDeviceMode,
  knownPeerCount,
  pairingMode,
  soloDeviceMode,
} from '#src/pairing-state.ts';

async function refreshKeyringState(): Promise<void> {
  try {
    const keyring = await loadOrCreateKeyring();
    knownPeerCount.value = keyring.knownPeers.size;
  } catch {
    knownPeerCount.value = null;
  }
}

interface MeshGateProps {
  children: ComponentChildren;
}

export function MeshGate({ children }: MeshGateProps): preact.JSX.Element | null {
  useSignalEffect(() => {
    if (knownPeerCount.value === null) {
      void refreshKeyringState().then(() => {
        void consumePairingHash();
      });
    }
    if (!soloDeviceMode.value) {
      hydrateSoloDeviceMode();
    }
  });

  if (knownPeerCount.value === null) {
    return null;
  }
  const paired = knownPeerCount.value > 0 || soloDeviceMode.value;
  const idle = pairingMode.value === 'idle';
  if (paired && idle) {
    return <>{children}</>;
  }
  return <LoginPage />;
}
