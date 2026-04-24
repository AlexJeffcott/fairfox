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

import { effect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { BuildFreshnessBanner } from '#src/build-freshness.tsx';
import { touchSelfDeviceEntry } from '#src/devices-state.ts';
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
    if (keyring.knownPeers.size > 0) {
      const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      touchSelfDeviceEntry(peerId, { agent: 'browser' });
    }
  } catch {
    knownPeerCount.value = null;
  }
}

interface RequirePairedProps {
  children: ComponentChildren;
}

let requirePairedEffectsInstalled = false;

/** Drive the keyring + solo-mode hydration that RequirePaired used to
 * run inside its own useSignalEffect. Called once from boot. */
export function installRequirePairedEffects(): void {
  if (requirePairedEffectsInstalled) {
    return;
  }
  requirePairedEffectsInstalled = true;
  effect(() => {
    if (knownPeerCount.value === null) {
      void refreshKeyringState();
    }
    if (!soloDeviceMode.value) {
      hydrateSoloDeviceMode();
    }
  });
}

export function RequirePaired({ children }: RequirePairedProps): preact.JSX.Element | null {
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
