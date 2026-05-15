// `fairfox peers …` — read and mutate the `mesh:devices` document and
// the local keyring from the CLI. Mirrors the Peers tab in the browser
// home sub-app: list, rename-self, forget, reconnect. One binary, one
// pairing, one source of truth.

import { hostname } from 'node:os';
import {
  type DeviceEntry,
  type DevicesDoc,
  devicesState,
  touchSelfDeviceEntry,
  upsertDeviceEntry,
} from '@fairfox/shared/devices-state';
import { awaitLoadedBudget } from '@fairfox/shared/loaded-budget';
import { $meshState, revokePeerLocally } from '@fairfox/shared/polly';
import {
  closeMesh,
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  openMeshClientReadOnly,
  waitForPeer,
} from '#src/mesh.ts';

const DEVICES_INITIAL: DevicesDoc = { devices: {} };

async function loadOwnPeerId(): Promise<string> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    throw new Error('no keyring — run `fairfox pair <token>` first');
  }
  return derivePeerId(keyring.identity.publicKey);
}

function formatEntry(entry: DeviceEntry, self: string): string {
  const selfBadge = entry.peerId === self ? ' (this device)' : '';
  const revokedBadge = entry.revokedAt ? ' [revoked]' : '';
  const agent = entry.agent.padEnd(9, ' ');
  const shortId = entry.peerId.slice(0, 12);
  const name = entry.name || '(unnamed)';
  return `${shortId}  ${agent}  ${name}${selfBadge}${revokedBadge}`;
}

export function peersList(includeRevoked = false): Promise<number> {
  return (async () => {
    const peerId = await loadOwnPeerId();
    // Read-only: no signalling, no WebRTC, no peerId on the wire.
    // Avoids racing a running `fairfox daemon` for the shared peerId
    // on the signalling server (the same keyring derives the same
    // peerId in both processes; the server boots whichever joined
    // first when the second one connects, and the resulting
    // ping-pong burns tens of seconds per command). Data freshness
    // depends on the daemon (or whichever process most recently
    // wrote to the local mesh storage) having sync'd the latest
    // state; for a read command that's the right trade.
    const mesh = openMeshClientReadOnly();
    try {
      const devices = $meshState<DevicesDoc>('mesh:devices', DEVICES_INITIAL);
      // Budget against the same shape as the networked path: the
      // wrapper's `.loaded` waits for handle.whenReady, which can
      // stall briefly even on a local-only path while NodeFS bytes
      // hydrate. Three seconds is the same budget `openMeshClient`
      // uses for the self-row write.
      await awaitLoadedBudget(devices.loaded, 3000);
      const allEntries = Object.values(devices.value.devices);
      // Hide revoked entries by default — they synced into mesh:devices
      // with `revokedAt` set when an admin clicked Forget. The browser's
      // PeersView already filters them out; pre-revoke output here was
      // padded with the historical leftovers. `--include-revoked`
      // shows everything for forensic / audit work.
      const entries = includeRevoked ? allEntries : allEntries.filter((e) => !e.revokedAt);
      const revokedCount = allEntries.length - entries.length;
      if (entries.length === 0) {
        process.stdout.write('(no devices yet — pair one from a browser or another CLI)\n');
        return 0;
      }
      entries.sort((a, b) => {
        if (a.peerId === peerId) {
          return -1;
        }
        if (b.peerId === peerId) {
          return 1;
        }
        return (a.name || a.peerId).localeCompare(b.name || b.peerId);
      });
      for (const entry of entries) {
        process.stdout.write(`${formatEntry(entry, peerId)}\n`);
      }
      if (revokedCount > 0 && !includeRevoked) {
        process.stdout.write(
          `(${revokedCount} revoked entr${revokedCount === 1 ? 'y' : 'ies'} hidden; \`fairfox peers --include-revoked\` to show)\n`
        );
      }
      return 0;
    } finally {
      await mesh.close();
    }
  })();
}

export function peersRenameSelf(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) {
    process.stderr.write('fairfox peers rename: expected a name.\n');
    return Promise.resolve(1);
  }
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      await waitForPeer(client, 8000);
      // Touch first to make sure an entry exists, then write the name.
      touchSelfDeviceEntry(peerId, { agent: 'cli', defaultName: hostname() });
      upsertDeviceEntry(peerId, { name: trimmed, agent: 'cli' });
      await flushOutgoing();
      process.stdout.write(`renamed: ${trimmed}\n`);
      return 0;
    } finally {
      await closeMesh(client);
    }
  })();
}

export function peersForget(peerIdToForget: string): Promise<number> {
  return (async () => {
    const storage = keyringStorage();
    const keyring = await storage.load();
    if (!keyring) {
      process.stderr.write('fairfox peers forget: no keyring on this machine.\n');
      return 1;
    }
    if (!keyring.knownPeers.has(peerIdToForget)) {
      process.stderr.write(`fairfox peers forget: no such peer "${peerIdToForget}".\n`);
      return 1;
    }
    // Crypto-level revoke (adds to `keyring.revokedPeers`) and drop
    // from the known-peer set so polly's network adapter refuses
    // further messages from this peer. Forget-local scope only; the
    // rest of the mesh still has this device in their keyrings.
    revokePeerLocally(peerIdToForget, keyring);
    keyring.knownPeers.delete(peerIdToForget);
    await storage.save(keyring);
    process.stdout.write(`forgot ${peerIdToForget}\n`);
    return 0;
  })();
}

/** Map-delete every entry in `mesh:devices` whose `revokedAt` is
 * set. The revocations themselves stay in the CRDT history — this
 * removes the entries from the document's materialised state, so
 * the "(N revoked entries hidden)" line goes to zero and the list
 * is clean.
 *
 * Not a byte-level history compaction. Automerge records each
 * delete as its own op, so the doc's on-disk and on-wire size
 * grows slightly. The proper byte-reclaim path is document
 * compaction under a new docId (`docs/adr/0008-…`), which has not
 * been built yet. Use this command when the materialised count is
 * what's bothering you; reach for ADR 0008 when storage size is.
 *
 * Networked: opens the full mesh client so the deletes broadcast
 * to every paired peer that's reachable. Devices that are offline
 * will pick up the deletes through normal CRDT merge on their
 * next sync. */
export function peersGcRevoked(): Promise<number> {
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      const peered = await waitForPeer(client, 8000);
      await devicesState.loaded;
      // Per-key deletes through `handle.change`, NOT a whole-map
      // replacement. Assigning `devicesState.value = { devices: kept }`
      // routes through polly's `applyTopLevel`, which lowers to a
      // single Automerge op `doc.devices = incoming` that replaces
      // the entire field — conflict-resolved by actor-id hash. A
      // concurrent per-key write on a remote peer (e.g. a self-row
      // `lastSeenAt` bump) then "wins" the merge on a coin-flip and
      // every delete in this batch is silently discarded on the
      // loser side. fairfox#22 caught this in the field: a daemon
      // ran `gc-revoked`, dropped 87 entries locally, but the
      // iPhone won the merge by actor-id hash and kept its 89-entry
      // view forever, with no diff for future sync rounds to merge.
      // Per-key `delete` ops merge cleanly under Automerge — every
      // receiver applies them as discrete per-key changes without
      // colliding with other per-key updates on the same map.
      const handle = devicesState.handle;
      if (!handle) {
        process.stdout.write('mesh:devices handle not bridged; cannot gc\n');
        return 1;
      }
      let removed = 0;
      handle.change((doc) => {
        if (!doc.devices) {
          return;
        }
        for (const id of Object.keys(doc.devices)) {
          if (doc.devices[id]?.revokedAt) {
            delete doc.devices[id];
            removed += 1;
          }
        }
      });
      if (removed === 0) {
        process.stdout.write('no revoked entries to remove\n');
        return 0;
      }
      if (peered) {
        await flushOutgoing(2000);
      }
      const peerSuffix = peered ? '' : ' (no peers reachable; will broadcast on next sync)';
      process.stdout.write(
        `removed ${removed} revoked entr${removed === 1 ? 'y' : 'ies'}${peerSuffix}\n`
      );
      return 0;
    } finally {
      await closeMesh(client);
    }
  })();
}

export function peersUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox peers — mesh-wide device list',
      '',
      'Usage:',
      '  fairfox peers                  List every paired device (this one first).',
      '  fairfox peers --include-revoked  Show revoked entries too (default: hidden).',
      '  fairfox peers rename <name>    Rename this device in the shared registry.',
      '  fairfox peers forget <peerId>  Stop syncing with a peer on this machine.',
      '  fairfox peers gc-revoked       Map-delete revoked entries from the doc.',
      '',
    ].join('\n')
  );
}

export function peers(rest: readonly string[]): Promise<number> {
  const [verb, ...args] = rest;
  if (!verb || verb === '--include-revoked') {
    return peersList(verb === '--include-revoked');
  }
  if (verb === 'rename') {
    return peersRenameSelf(args.join(' '));
  }
  if (verb === 'forget' && args[0]) {
    return peersForget(args[0]);
  }
  if (verb === 'gc-revoked') {
    return peersGcRevoked();
  }
  if (verb === 'help' || verb === '--help' || verb === '-h') {
    peersUsage(process.stdout);
    return Promise.resolve(0);
  }
  peersUsage();
  return Promise.resolve(1);
}
