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
import {
  addEndorsementToDevice,
  removeEndorsementFromDevice,
  revokeDeviceEntry,
  touchSelfDeviceEntry,
  upsertDeviceEntry,
} from '@fairfox/shared/devices-state';
import { forgetPeer, loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { MeshGate } from '@fairfox/shared/mesh-gate';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { canDo } from '@fairfox/shared/policy';
import { pwaInstallActions } from '@fairfox/shared/pwa-install';
import { signDeviceRevocation, signEndorsement } from '@fairfox/shared/user-identity';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import {
  type Permission,
  revokeUser,
  setUserGrants,
  usersState,
} from '@fairfox/shared/users-state';
import { render } from 'preact';
import { Home, setActiveView } from '#src/client/Home.tsx';
import { selfPeerId, setSelfPeerId } from '#src/client/self-peer.ts';

function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set<Permission>([
  'user.invite',
  'user.revoke',
  'user.grant-role',
  'device.pair',
  'device.rename',
  'device.revoke',
  'device.designate-llm',
  'subapp.install',
  'todo.write',
  'agenda.write',
  'agenda.complete-other',
]);

function parsePermission(input: string | undefined): Permission | undefined {
  if (!input) {
    return undefined;
  }
  if (!KNOWN_PERMISSIONS.has(input)) {
    return undefined;
  }
  // Safe now: the set's element type is Permission, so membership
  // narrows to that. The explicit assertion below is `as unknown as
  // const` — a concession to TypeScript that membership on a
  // Set<string> doesn't narrow. Keeping it local means no `any`
  // escape hatch in the wider codebase.
  const all: readonly Permission[] = [
    'user.invite',
    'user.revoke',
    'user.grant-role',
    'device.pair',
    'device.rename',
    'device.revoke',
    'device.designate-llm',
    'subapp.install',
    'todo.write',
    'agenda.write',
    'agenda.complete-other',
  ];
  return all.find((p) => p === input);
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
    const identity = userIdentity.value;
    if (!identity) {
      console.warn('[peers.forget-local] no user identity — cannot sign revocation');
      return;
    }
    void (async () => {
      // Tombstone the device in mesh:devices so every peer sees the
      // revocation via CRDT sync — harvestPeerKeys now skips revoked
      // rows, so the peer can't be re-added to anyone's keyring on
      // reload. Then drop it from the local keyring + reload so this
      // device's mesh adapter stops dialling it.
      try {
        revokeDeviceEntry(peerId, signDeviceRevocation(identity, peerId));
      } catch (err) {
        console.error('[peers.forget-local] revoke failed:', err);
      }
      const keyring = await loadOrCreateKeyring();
      await forgetPeer(keyring, peerId);
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    })();
  },
  'app.reload': () => {
    // PWAs — and especially iOS standalone PWAs — don't have a
    // refresh gesture, and a stuck service worker can pin them on a
    // stale bundle even after the server has shipped a newer one.
    // This handler does a three-step hard-reload: unregister the
    // service worker (so the next fetch goes all the way to the
    // origin), bypass the HTTP cache via `location.reload(true)`
    // where supported, and fall back to the plain reload otherwise.
    void (async () => {
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        }
      } catch {
        // best-effort
      }
      window.location.reload();
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
  'devices.add-me': (ctx) => {
    // Endorse another device on behalf of the local user — the
    // shared-tablet flow. `device.pair` is the required permission
    // because adding a user to a shared device is effectively
    // extending that user's authority to a new peer. The
    // intersection semantics mean this can only LOWER the target
    // device's effective permissions (we add our own set to the
    // mix), so the check is a sanity gate, not a security one.
    if (!canDo('device.pair')) {
      console.warn('[policy] blocked devices.add-me: user lacks device.pair');
      return;
    }
    const targetPeerId = ctx.data.peerId;
    if (!targetPeerId) {
      return;
    }
    const identity = userIdentity.value;
    if (!identity) {
      return;
    }
    try {
      addEndorsementToDevice(targetPeerId, signEndorsement(identity, targetPeerId));
    } catch (err) {
      console.error('[devices.add-me]', err);
    }
  },
  'devices.leave': (ctx) => {
    const targetPeerId = ctx.data.peerId;
    if (!targetPeerId) {
      return;
    }
    const identity = userIdentity.value;
    if (!identity) {
      return;
    }
    try {
      removeEndorsementFromDevice(targetPeerId, identity.userId);
    } catch (err) {
      console.error('[devices.leave]', err);
    }
  },
  'users.toggle-grant': (ctx) => {
    if (!canDo('user.grant-role')) {
      console.warn('[policy] blocked users.toggle-grant: user lacks user.grant-role');
      return;
    }
    const targetUserId = ctx.data.userId;
    const permission = parsePermission(ctx.data.permission);
    if (!targetUserId || !permission) {
      return;
    }
    const identity = userIdentity.value;
    if (!identity) {
      return;
    }
    const entry = usersState.value.users[targetUserId];
    if (!entry) {
      return;
    }
    const has = entry.grants.some((g) => g.permission === permission);
    const nextGrants = has
      ? entry.grants.filter((g) => g.permission !== permission)
      : [...entry.grants, { permission }];
    try {
      setUserGrants({
        userId: targetUserId,
        grants: nextGrants,
        granterUserId: identity.userId,
        granterUserKey: identity.keypair,
      });
    } catch (err) {
      console.error('[users.toggle-grant]', err);
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
