// Mesh connection helper for the CLI. Wraps polly's createMeshClient with
// the Node WebRTC implementation (werift), file-backed keyring storage
// under ~/.fairfox/keyring.json, and the WebSocket global that Bun
// already exposes. Shared by every subcommand that reaches into the mesh.

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { MeshClient, MeshKeyring } from '@fairfox/polly/mesh';
import { createMeshClient } from '@fairfox/polly/mesh';
import { fileKeyringStorage, type KeyringStorage } from '@fairfox/polly/mesh/node';
import { RTCPeerConnection } from 'werift';

export const KEYRING_PATH = join(homedir(), '.fairfox', 'keyring.json');

export function defaultSignalingUrl(): string {
  const base = process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
  const proto = base.startsWith('https') ? 'wss' : 'ws';
  const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `${proto}://${host}/polly/signaling`;
}

export function keyringStorage(): KeyringStorage {
  // polly's fileKeyringStorage doesn't create the parent directory
  // before its write-to-tmp-then-rename dance, so the first save on
  // a fresh machine fails at `open(...tmp)` if the user's profile
  // directory (e.g. ~/.fairfox/) doesn't exist yet. Wrap the save
  // with an mkdir until polly picks up the guard upstream.
  const inner = fileKeyringStorage(KEYRING_PATH);
  const parent = dirname(KEYRING_PATH);
  return {
    load: inner.load.bind(inner),
    save: async (keyring: MeshKeyring): Promise<void> => {
      await mkdir(parent, { recursive: true });
      return inner.save(keyring);
    },
  };
}

export function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ConnectOptions {
  peerId: string;
  signalingUrl?: string;
}

/**
 * Open a mesh client using the on-disk keyring. Caller is responsible
 * for `await client.close()` when done.
 */
export async function openMeshClient(options: ConnectOptions): Promise<MeshClient> {
  return await createMeshClient({
    signaling: {
      url: options.signalingUrl ?? defaultSignalingUrl(),
      peerId: options.peerId,
    },
    keyring: { storage: keyringStorage() },
    rtc: { RTCPeerConnection: RTCPeerConnection as unknown as typeof RTCPeerConnection },
  });
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
