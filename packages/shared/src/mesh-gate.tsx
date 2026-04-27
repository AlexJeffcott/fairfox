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

import { effect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
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
import { QrScanDialog } from '#src/qr-scan.tsx';
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
async function selfHealIdentity(): Promise<boolean> {
  const identity = userIdentity.value;
  if (!identity) {
    return false;
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
  if (signedByMe) {
    // Already endorsed: we still want to bump lastSeenAt on every
    // mount so the Peers view shows a fresh timestamp for this
    // device. Without this, a device that stays endorsed forever
    // never updates its own row, and its Peers-tab entry reads as
    // stale "last seen 16h ago" for as long as the PWA is open.
    touchSelfDeviceEntry(peerId, { agent: 'browser' });
    return true;
  }
  touchSelfDeviceEntry(peerId, { agent: 'browser' });
  addEndorsementToDevice(peerId, signEndorsement(identity, peerId));
  // Confirm the write landed in memory before declaring success.
  // upsertDeviceEntry is synchronous over the signal, so the row is
  // present immediately after addEndorsementToDevice returns.
  const after = devicesState.value.devices[peerId];
  return (after?.endorsements ?? []).some((e) => e.userId === identity.userId);
}

/** Minimal "I'm still here" heartbeat for a device with no user
 * identity yet. Just bumps lastSeenAt on the device row so the
 * Peers view reflects that the PWA is actually open. Safe to
 * call on every mount; idempotent. */
async function bumpSelfLastSeen(): Promise<void> {
  await devicesState.loaded;
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  touchSelfDeviceEntry(peerId, { agent: 'browser' });
}

/** Module-level guards. The plain heartbeat (`bumpSelfLastSeen`) is
 * one-and-done — it just wants a fresh lastSeenAt on mount. The
 * heal path is "fire until our row is endorsed", because the
 * post-pair IndexedDB flush race can leave devicesState rehydrated
 * without our self-endorsement and only a re-run lands the row in
 * memory. The retry guard tracks whether we've successfully healed
 * (signedByMe == true seen at least once) so subsequent re-ticks
 * skip the work. */
let bumpFired = false;
let selfHealCompletedForUserId: string | null = null;

let meshGateEffectsInstalled = false;

/** Install the reactive effects that drive MeshGate's state:
 * self-device heartbeat, keyring refresh, solo-mode hydration,
 * user-identity hydration, and the reactive harvest of peer keys
 * out of `mesh:devices`. Previously these ran inside two
 * `useSignalEffect` blocks on MeshGate — moved out so the component
 * body contains no hooks. Called once from boot. */
export function installMeshGateEffects(): void {
  if (meshGateEffectsInstalled) {
    return;
  }
  meshGateEffectsInstalled = true;

  // The self-device heartbeat. Waits for userIdentity to settle
  // (leave `undefined`) before firing. Previously inline in
  // useSignalEffect — an earlier version lived inside the reactive
  // harvest block below and caused an infinite write loop because
  // touchSelfDeviceEntry rewrites devicesState, which re-ticked the
  // effect. Splitting it out keeps that fix intact.
  //
  // Heal path subscribes to devicesState too: post-pair, our
  // self-endorsement may not be in the rehydrated doc, in which
  // case selfHealIdentity adds it. The retry guard
  // (selfHealCompletedForUserId) flips once we've seen our
  // endorsement settle — subsequent ticks skip the work, so
  // touchSelfDeviceEntry can't loop. The bump path stays
  // one-and-done because it doesn't need to monitor doc state.
  effect(() => {
    if (userIdentity.value === undefined) {
      return;
    }
    const identity = userIdentity.value;
    if (!identity) {
      if (bumpFired) {
        return;
      }
      bumpFired = true;
      void bumpSelfLastSeen();
      return;
    }
    // Read devicesState so this effect re-ticks when it changes —
    // that is what gives selfHealIdentity another chance after the
    // post-pair reload's hydrate races the IDB flush.
    void devicesState.value;
    if (selfHealCompletedForUserId === identity.userId) {
      return;
    }
    void selfHealIdentity().then((settled) => {
      if (settled) {
        selfHealCompletedForUserId = identity.userId;
      }
    });
  });

  effect(() => {
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
    // Reactive harvest: whenever mesh:devices changes (including
    // the initial load), pull any unknown pubkeys into our keyring.
    // Reading devicesState.value subscribes this effect to doc-state
    // changes.
    void devicesState.value;
    void harvestAndMaybeReload();
  });
}

export function MeshGate({ children }: MeshGateProps): preact.JSX.Element | null {
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
        <QrScanDialog />
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
