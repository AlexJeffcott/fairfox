// Mesh connection helper for the CLI. Wraps polly's createMeshClient with
// the Node WebRTC implementation (werift), file-backed keyring storage
// under ~/.fairfox/keyring.json, and the WebSocket global that Bun
// already exposes. Shared by every subcommand that reaches into the mesh.

import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { devicesState, harvestPeerKeys, touchSelfDeviceEntry } from '@fairfox/shared/devices-state';
import type { KeyringStorage, MeshClient } from '@fairfox/shared/polly';
import { createMeshClient, fileKeyringStorage } from '@fairfox/shared/polly';
import { RTCPeerConnection } from 'werift';

export const KEYRING_PATH = join(homedir(), '.fairfox', 'keyring.json');
export const REPO_STORAGE_PATH = join(homedir(), '.fairfox', 'mesh');

export function defaultSignalingUrl(): string {
  const base = process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
  const proto = base.startsWith('https') ? 'wss' : 'ws';
  const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `${proto}://${host}/polly/signaling`;
}

export function keyringStorage(): KeyringStorage {
  return fileKeyringStorage(KEYRING_PATH);
}

export function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ConnectOptions {
  peerId: string;
  signalingUrl?: string;
  /** Optional custom-frame subscription — forwarded to polly's
   * `signaling.onCustomFrame`. The `mesh invite open` command uses
   * this to listen for pair-return frames while the QR is on
   * screen. */
  onCustomFrame?: (frame: { type: string; [k: string]: unknown }) => void;
}

/**
 * Open a mesh client using the on-disk keyring. Caller is responsible
 * for `await client.close()` when done. Also writes this CLI's own
 * entry into the `mesh:devices` document (or bumps `lastSeenAt` if it
 * already exists), so `fairfox peers` and the browser's peer list
 * show the CLI under a sensible default name — the machine's
 * hostname — which the user can rename later.
 */
export async function openMeshClient(options: ConnectOptions): Promise<MeshClient> {
  const client = await createMeshClient({
    signaling: {
      url: options.signalingUrl ?? defaultSignalingUrl(),
      peerId: options.peerId,
      onCustomFrame: options.onCustomFrame,
    },
    keyring: { storage: keyringStorage() },
    // Persist the Automerge docs to disk so the CLI is a real peer
    // — writes land in ~/.fairfox/mesh/ and survive process exit,
    // even when no other peer is connected at write time.
    repoStorage: new NodeFSStorageAdapter(REPO_STORAGE_PATH),
    // werift's RTCPeerConnection implements the subset polly needs but
    // doesn't declare the full DOM spec (e.g. `generateCertificate`),
    // so the cast bridges the structural gap. The rtc field only uses
    // the instance-level API (createOffer/createAnswer/data channels)
    // which werift does satisfy.
    // biome-ignore lint/suspicious/noExplicitAny: werift shim to DOM type
    rtc: { RTCPeerConnection: RTCPeerConnection as unknown as any },
  });
  // The `mesh:devices` write happens against the same Repo the client
  // just configured; $meshState is safe to call after createMeshClient
  // returns. The write runs fire-and-forget — the document handle
  // buffers locally and flushes on `flushOutgoing` at command exit.
  try {
    // Wait for the primitive's storage-hydration to complete before
    // writing. Otherwise a fresh CLI touches the self-row into the
    // in-memory signal, storage then loads its (older) copy over the
    // top, and the self-row never reaches the Automerge doc at all —
    // which is why `fairfox peers` saw every peer but itself.
    await devicesState.loaded;
    // Publish our pubkey in mesh:devices so other peers can harvest
    // it and add us to their keyring without a pair-token exchange.
    const storage = keyringStorage();
    const keyring = await storage.load();
    const publicKey = keyring?.identity.publicKey;
    touchSelfDeviceEntry(options.peerId, {
      agent: 'cli',
      defaultName: hostname(),
      ...(publicKey ? { publicKey } : {}),
    });
    // Harvest unknown pubkeys from mesh:devices into the CLI's
    // keyring. If any land, persist them — the running MeshClient
    // won't pick them up without a restart, but the next CLI
    // invocation will be a full-trust peer.
    if (keyring) {
      const added = harvestPeerKeys(keyring);
      if (added.length > 0) {
        await storage.save(keyring);
      }
    }
  } catch {
    // Never block a CLI invocation on device-entry housekeeping.
  }
  return client;
}

/**
 * Wait until the Automerge Repo reports at least one peer, or the
 * deadline elapses. Callers that only want to _read_ the current state
 * can tolerate a zero-peer exit; callers that mutate should insist on
 * convergence.
 */
export async function waitForPeer(client: MeshClient, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.repo.peers.length > 0) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return client.repo.peers.length > 0;
}

/**
 * Give Automerge a little slack after a mutation so sync messages have
 * a chance to reach every connected peer before the process exits.
 */
export async function flushOutgoing(ms = 1500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
