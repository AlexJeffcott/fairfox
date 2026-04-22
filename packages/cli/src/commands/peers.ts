// `fairfox peers …` — read and mutate the `mesh:devices` document and
// the local keyring from the CLI. Mirrors the Peers tab in the browser
// home sub-app: list, rename-self, forget, reconnect. One binary, one
// pairing, one source of truth.

import { hostname } from 'node:os';
import {
  type DeviceEntry,
  type DevicesDoc,
  touchSelfDeviceEntry,
  upsertDeviceEntry,
} from '@fairfox/shared/devices-state';
import { $meshState, revokePeerLocally } from '@fairfox/shared/polly';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
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
  const agent = entry.agent.padEnd(9, ' ');
  const shortId = entry.peerId.slice(0, 12);
  const name = entry.name || '(unnamed)';
  return `${shortId}  ${agent}  ${name}${selfBadge}`;
}

export function peersList(): Promise<number> {
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      const peered = await waitForPeer(client, 8000);
      const devices = $meshState<DevicesDoc>('mesh:devices', DEVICES_INITIAL);
      await devices.loaded;
      if (peered) {
        await flushOutgoing(2000);
      }
      const entries = Object.values(devices.value.devices);
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
      return 0;
    } finally {
      await client.close();
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
      await client.close();
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

export function peersUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox peers — mesh-wide device list',
      '',
      'Usage:',
      '  fairfox peers                  List every paired device (this one first).',
      '  fairfox peers rename <name>    Rename this device in the shared registry.',
      '  fairfox peers forget <peerId>  Stop syncing with a peer on this machine.',
      '',
    ].join('\n')
  );
}

export function peers(rest: readonly string[]): Promise<number> {
  const [verb, ...args] = rest;
  if (!verb) {
    return peersList();
  }
  if (verb === 'rename') {
    return peersRenameSelf(args.join(' '));
  }
  if (verb === 'forget' && args[0]) {
    return peersForget(args[0]);
  }
  if (verb === 'help' || verb === '--help' || verb === '-h') {
    peersUsage(process.stdout);
    return Promise.resolve(0);
  }
  peersUsage();
  return Promise.resolve(1);
}
