/** @jsxImportSource preact */
// MeshGate — wraps a sub-app's root render and withholds its children
// until the device satisfies the gate. The gate opens when the mesh
// keyring has at least one peer or when the user has explicitly opted
// this device into solo mode. While the gate is still resolving its
// initial state (keyring load in flight, solo flag not yet hydrated)
// the wrapper renders nothing at all rather than flashing the login
// page, which would otherwise appear for the handful of milliseconds
// between first render and the keyring IndexedDB read resolving.
//
// Every fairfox sub-app wraps its <App /> in <MeshGate> at boot so no
// $meshState-backed surface leaks to an unpaired device.

import { useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { LoginPage } from '#src/login-page.tsx';
import { hydrateSoloDeviceMode, knownPeerCount, soloDeviceMode } from '#src/pairing-state.ts';

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
      void refreshKeyringState();
    }
    if (!soloDeviceMode.value) {
      hydrateSoloDeviceMode();
    }
  });

  if (knownPeerCount.value === null) {
    return null;
  }
  if (knownPeerCount.value === 0 && !soloDeviceMode.value) {
    return <LoginPage />;
  }
  return <>{children}</>;
}
