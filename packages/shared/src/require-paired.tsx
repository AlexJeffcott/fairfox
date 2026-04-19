/** @jsxImportSource preact */
// RequirePaired — the sub-app-side half of the fairfox-level pairing gate.
//
// The landing sub-app at `/` handles pairing for the whole origin. Every
// other sub-app is free to assume the device is already paired: its mesh
// state, its controls, its identity, all rest on that assumption. What it
// cannot assume is that the user *arrived* via the landing — deep links
// from a pairing email, a PWA shortcut, or a bookmark into `/todo-v2` all
// bypass the gate. RequirePaired is the sub-app's answer: it reads the
// keyring once, and if the device is neither paired nor explicitly solo
// it sends the tab to `/` so the landing can take over.
//
// Until the keyring read resolves the component renders nothing. A flash
// of sub-app content before the redirect would defeat the point and
// leak half-rendered state into an unpaired device.

import { useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { BuildFreshnessBanner } from '#src/build-freshness.tsx';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { LoginPage } from '#src/login-page.tsx';
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

interface RequirePairedProps {
  children: ComponentChildren;
}

export function RequirePaired({ children }: RequirePairedProps): preact.JSX.Element | null {
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
  const paired = knownPeerCount.value > 0 || soloDeviceMode.value;
  if (!paired) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.replace('/');
    }
    return null;
  }
  // A paired device can still open the pairing wizard — the "Pair another
  // device" control in every sub-app header does exactly that, flipping
  // pairingMode out of 'idle'. While the wizard is active, render the
  // LoginPage in place of the sub-app so the ceremony has somewhere to
  // show its QR / paste box. Cancelling the ceremony returns pairingMode
  // to 'idle' and the sub-app reappears.
  if (pairingMode.value !== 'idle') {
    return (
      <>
        <LoginPage />
        <BuildFreshnessBanner />
      </>
    );
  }
  return (
    <>
      {children}
      <BuildFreshnessBanner />
    </>
  );
}
