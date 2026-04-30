// Home sub-app action handlers. Extracted from boot.tsx so the
// unified app's registry can merge them in the same shape as every
// other sub-app (`import { homeActions } from '#src/client/...'`).
//
// These are the handlers for the landing page — switching the Apps
// / Peers / Users / Help tabs, the peer-management controls, the
// hard-reload button, the revoke / add-me / leave / grant-toggle
// flows on users and devices.

import { ConfirmDialog } from '@fairfox/polly/ui';
import {
  addEndorsementToDevice,
  removeEndorsementFromDevice,
  revokeDeviceEntry,
  upsertDeviceEntry,
} from '@fairfox/shared/devices-state';
import { forgetPeer, loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { canDo } from '@fairfox/shared/policy';
import { signDeviceRevocation, signEndorsement } from '@fairfox/shared/user-identity';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import {
  type Permission,
  revokeUser,
  setUserGrants,
  usersState,
} from '@fairfox/shared/users-state';
import { setActiveView } from '#src/client/Home.tsx';
import { selfPeerId } from '#src/client/self-peer.ts';

type HandlerContext = {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
};

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

export const homeActions: Record<string, (ctx: HandlerContext) => void> = {
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
    // stack from the keyring and re-establishes every channel.
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
  'app.reset-local': () => {
    // Nuclear: wipe every IndexedDB the fairfox origin owns (keyring,
    // user identity, mesh docs, automerge storage), unregister the
    // service worker so the next fetch goes to origin, and reload.
    // The user lands on the pairing login page and re-joins the mesh
    // from a clean slate. Use when the local Automerge state is
    // corrupt or a sync message is blowing out WASM memory.
    if (typeof window === 'undefined') {
      return;
    }
    void (async () => {
      const ok = await ConfirmDialog.confirm({
        title: 'Reset this device?',
        body:
          'This clears every fairfox database on this browser (keyring, user identity, mesh documents) and reloads. ' +
          "You'll need to re-pair afterwards; other paired devices and the mesh data are unaffected.",
        danger: true,
        confirmLabel: 'Reset and reload',
      });
      if (!ok) {
        return;
      }
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        }
      } catch {
        // best-effort
      }
      try {
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          await Promise.all(
            dbs
              .filter((db) => typeof db.name === 'string')
              .map((db) => {
                const name = db.name;
                if (typeof name !== 'string') {
                  return Promise.resolve();
                }
                return new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(name);
                  req.onsuccess = () => {
                    resolve();
                  };
                  req.onerror = () => {
                    resolve();
                  };
                  req.onblocked = () => {
                    resolve();
                  };
                });
              })
          );
        }
      } catch {
        // best-effort
      }
      try {
        if (caches) {
          const names = await caches.keys();
          await Promise.all(names.map((n) => caches.delete(n)));
        }
      } catch {
        // best-effort
      }
      try {
        window.localStorage?.clear();
      } catch {
        // best-effort
      }
      window.location.reload();
    })();
  },

  'app.reload': () => {
    // PWAs — and especially iOS standalone PWAs — don't have a
    // refresh gesture, and a stuck service worker can pin them on a
    // stale bundle even after the server has shipped a newer one.
    // Unregister the service worker so the next fetch goes all the
    // way to the origin, then reload.
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
