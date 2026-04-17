/** @jsxImportSource preact */
// MeshGate — wraps a sub-app's root render and withholds its children
// until the device satisfies the gate. The gate opens when the mesh
// keyring has at least one peer or when the user has explicitly opted
// this device into solo mode. While either is unresolved the gate
// renders <LoginPage /> instead of the sub-app.
//
// Every fairfox sub-app wraps its <App /> in <MeshGate> at boot so no
// $meshState-backed surface leaks to an unpaired device.

import { useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { LoginPage } from '#src/login-page.tsx';
import {
  hydrateSoloDeviceMode,
  knownPeerCount,
  meshGateOpen,
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

export function MeshGate({ children }: MeshGateProps): preact.JSX.Element {
  useSignalEffect(() => {
    if (knownPeerCount.value === null) {
      void refreshKeyringState();
    }
    if (!soloDeviceMode.value) {
      hydrateSoloDeviceMode();
    }
  });

  if (!meshGateOpen.value) {
    return <LoginPage />;
  }
  return <>{children}</>;
}
