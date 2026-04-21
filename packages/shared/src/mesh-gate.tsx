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
import { useEffect } from 'preact/hooks';
import { BuildFreshnessBanner } from '#src/build-freshness.tsx';
import {
  addEndorsementToDevice,
  devicesState,
  harvestPeerKeys,
  touchSelfDeviceEntry,
} from '#src/devices-state.ts';
import { loadOrCreateKeyring, saveKeyring } from '#src/keyring.ts';
import { LoginPage } from '#src/login-page.tsx';
import { consumePairingHash } from '#src/pairing-actions.ts';
import {
  hydrateSoloDeviceMode,
  knownPeerCount,
  pairingMode,
  soloDeviceMode,
} from '#src/pairing-state.ts';
import { signEndorsement } from '#src/user-identity.ts';
import { hydrateUserIdentity, userIdentity } from '#src/user-identity-state.ts';
import { createBootstrapUser, upsertUser, usersState } from '#src/users-state.ts';

async function refreshKeyringState(): Promise<void> {
  try {
    const keyring = await loadOrCreateKeyring();
    knownPeerCount.value = keyring.knownPeers.size;
    if (keyring.knownPeers.size > 0) {
      const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      // Publish our own pubkey in mesh:devices so other peers can
      // harvest it into their keyring without a direct pair-token
      // exchange.
      touchSelfDeviceEntry(peerId, { agent: 'browser', publicKey: keyring.identity.publicKey });
    }
  } catch {
    knownPeerCount.value = null;
  }
}

/** Read every device row in mesh:devices, pull out pubkeys we
 * don't yet trust, add them to the local keyring, and reload so
 * MeshClient's adapter picks up the new trust set. Runs every time
 * the devices doc changes — a fresh row landing in sync fans out
 * to all browsers that see it. */
async function harvestAndMaybeReload(): Promise<void> {
  try {
    const keyring = await loadOrCreateKeyring();
    const added = harvestPeerKeys(keyring);
    if (added.length === 0) {
      return;
    }
    await saveKeyring(keyring);
    if (typeof window !== 'undefined') {
      // Small fence so the mesh:devices write + save settle before
      // the page tears down.
      setTimeout(() => {
        window.location.reload();
      }, 300);
    }
  } catch {
    // Best-effort — harvest failures shouldn't break the gate.
  }
}

interface MeshGateProps {
  children: ComponentChildren;
}

/** Self-heal for the split-brain where a device has a loaded user
 * identity (via recovery-blob import or CLI-signed add-device QR)
 * but `mesh:users` doesn't yet carry that user's row. Causes: CLI
 * minted the mesh and closed before the WebRTC handshake
 * synchronized full doc state to the browser. Effect: canDo() returns
 * false on everything because `liveUser()` can't find the id. The
 * repair is idempotent — if someone else's copy of the entry shows
 * up later via sync, CRDT merge handles the duplicate. */
async function selfHealIdentity(): Promise<void> {
  const identity = userIdentity.value;
  if (!identity) {
    return;
  }
  await Promise.all([usersState.loaded, devicesState.loaded]);
  if (!usersState.value.users[identity.userId]) {
    upsertUser({
      entry: createBootstrapUser({
        displayName: identity.displayName,
        userKey: identity.keypair,
      }),
    });
  }
  // Also make sure this device's mesh:devices row endorses the
  // local user; without that endorsement the intersection gate
  // returns empty even when the user's row IS present.
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const deviceRow = devicesState.value.devices[peerId];
  // Gate on the endorsement *signature* being present, not just on
  // the userId appearing in ownerUserIds. If the two drift (the
  // laptop's "Add me" writes both, but a CRDT merge keeps
  // ownerUserIds while the endorsements array on the phone's copy
  // of the row remained empty), the old check short-circuits and
  // the phone stays read-only with "no endorsed user has any
  // permissions" forever. Re-endorsing is idempotent.
  const endorsements = deviceRow?.endorsements ?? [];
  const signedByMe = endorsements.some((e) => e.userId === identity.userId);
  if (!signedByMe) {
    touchSelfDeviceEntry(peerId, { agent: 'browser' });
    addEndorsementToDevice(peerId, signEndorsement(identity, peerId));
  }
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
    if (userIdentity.value === undefined) {
      void hydrateUserIdentity();
    }
    if (userIdentity.value) {
      void selfHealIdentity();
    }
    // Reactive harvest: whenever mesh:devices changes (including
    // the initial load), pull any unknown pubkeys into our keyring.
    // `devicesState.value` is the dependency — reading it here
    // subscribes this effect to doc-state changes.
    void devicesState.value;
    void harvestAndMaybeReload();
  });

  // A `#pair=…` URL pasted into an already-open tab changes only the
  // hash, so Preact never re-mounts and the effect above never re-runs.
  // Listen for the hashchange event directly so link consumption works
  // regardless of how the user arrives at the fragment.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const onHashChange = (): void => {
      if (window.location.hash.startsWith('#pair=')) {
        void consumePairingHash();
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (knownPeerCount.value === null) {
    return null;
  }
  const paired = knownPeerCount.value > 0 || soloDeviceMode.value;
  const idle = pairingMode.value === 'idle';
  if (paired && idle) {
    return (
      <>
        {children}
        <BuildFreshnessBanner />
      </>
    );
  }
  return (
    <>
      <LoginPage />
      <BuildFreshnessBanner />
    </>
  );
}
