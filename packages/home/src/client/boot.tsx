/** @jsxImportSource preact */
// Boot sequence for the fairfox landing / home sub-app.
//
// The landing is where pairing lives. Every other sub-app trusts that
// the device is already paired; if it is not, they redirect here. Home
// therefore runs the MeshGate around its own content: unpaired devices
// see the pairing login page, paired devices see the sub-app grid and
// the peers list.
//
// The home page does read `$meshState` — `mesh:devices` drives the
// peers list — so boot pulls in `ensure-mesh` transitively through
// `@fairfox/shared/devices-state` (via PeersView). The action registry
// bundles the pairing, build-freshness, PWA-install, and home-local
// (rename, forget, reconnect, tab) handlers.

import '@fairfox/polly/ui/styles.css';
import '@fairfox/polly/ui/theme.css';

import { type ActionDispatch, installEventDelegation } from '@fairfox/polly/actions';
import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { touchSelfDeviceEntry, upsertDeviceEntry } from '@fairfox/shared/devices-state';
import { forgetPeer, loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { MeshGate } from '@fairfox/shared/mesh-gate';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { canDo } from '@fairfox/shared/policy';
import { pwaInstallActions } from '@fairfox/shared/pwa-install';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import { revokeUser } from '@fairfox/shared/users-state';
import { render } from 'preact';
import { Home, setActiveView } from '#src/client/Home.tsx';
import { selfPeerId, setSelfPeerId } from '#src/client/self-peer.ts';

function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type HandlerContext = {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
};

const homeActions: Record<string, (ctx: HandlerContext) => void> = {
  'home.tab': (ctx) => {
    if (ctx.data.id) {
      setActiveView(ctx.data.id);
    }
  },
  'peers.rename-self': (ctx) => {
    const name = ctx.data.value?.trim();
    if (!name) {
      return;
    }
    const peerId = selfPeerId.value;
    if (!peerId) {
      return;
    }
    upsertDeviceEntry(peerId, { name, agent: 'browser' });
  },
  'peers.reconnect': (ctx) => {
    // Per-peer reconnect is not surfaced by polly's MeshClient — its
    // WebRTC adapter exposes no per-peer close. The nearest-cost
    // operation is a full-client reload, which reconstructs the mesh
    // stack from the keyring and re-establishes every channel. A full
    // reload is coarser than we'd like but honest about what can
    // actually be forced from here.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
    void ctx;
  },
  'peers.forget-local': (ctx) => {
    if (!canDo('device.revoke')) {
      console.warn('[policy] blocked peers.forget-local: user lacks device.revoke');
      return;
    }
    const peerId = ctx.data.peerId;
    if (!peerId) {
      return;
    }
    void (async () => {
      const keyring = await loadOrCreateKeyring();
      await forgetPeer(keyring, peerId);
      // Reload so the mesh client drops the forgotten peer from its
      // adapter's known-peer set. Without the reload the adapter keeps
      // dialling until the next natural page load.
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    })();
  },
  'users.revoke-peer': (ctx) => {
    if (!canDo('user.revoke')) {
      console.warn('[policy] blocked users.revoke-peer: user lacks user.revoke');
      return;
    }
    const targetUserId = ctx.data.userId;
    if (!targetUserId) {
      return;
    }
    const identity = userIdentity.value;
    if (!identity) {
      return;
    }
    try {
      revokeUser({
        userId: targetUserId,
        revokerUserId: identity.userId,
        revokerUserKey: identity.keypair,
      });
    } catch (err) {
      console.error('[users.revoke-peer]', err);
    }
  },
};

const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,
  ...pwaInstallActions,
  ...homeActions,
};

installEventDelegation((d: ActionDispatch) => {
  const handler = registry[d.action];
  if (handler) {
    handler({ data: d.data, event: d.event, element: d.element });
  }
});

// Populate the self-peer id as soon as the keyring resolves so
// PeersView can flag this device's own row. Independent of
// MeshGate's own load path — both end up reading the same keyring
// blob, and the kerying load is idempotent.
void (async () => {
  try {
    const keyring = await loadOrCreateKeyring();
    const peerId = derivePeerId(keyring.identity.publicKey);
    setSelfPeerId(peerId);
    if (keyring.knownPeers.size > 0) {
      touchSelfDeviceEntry(peerId, { agent: 'browser' });
    }
  } catch {
    // Best-effort. If the keyring load fails the gate will surface
    // the error through its own path.
  }
})();

const root = document.getElementById('app');
if (root) {
  render(
    <MeshGate>
      <Home />
    </MeshGate>,
    root
  );
}
