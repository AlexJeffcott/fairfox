// Mesh connection helper for the CLI. Wraps polly's createMeshClient with
// the Node WebRTC implementation (werift), file-backed keyring storage
// under ~/.fairfox/keyring.json, and the WebSocket global that Bun
// already exposes. Shared by every subcommand that reaches into the mesh.
//
// The keyring-storage code is duplicated from polly rather than imported
// because @fairfox/polly 0.27.1's published mesh-node bundle has its
// node:fs/promises dependency erased by the browser-target bundler —
// `var {readFile, rename, writeFile} = (() => ({}))` in the dist means
// the real filesystem primitives are undefined at runtime. A polly fix
// will restore the import site; until then, a local implementation
// sidesteps the bug.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { MeshClient, MeshKeyring } from '@fairfox/polly/mesh';
import { createMeshClient } from '@fairfox/polly/mesh';
import {
  deserialiseKeyring,
  type KeyringStorage,
  serialiseKeyring,
} from '@fairfox/polly/mesh/node';
import { RTCPeerConnection } from 'werift';

export const KEYRING_PATH = join(homedir(), '.fairfox', 'keyring.json');

export function defaultSignalingUrl(): string {
  const base = process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
  const proto = base.startsWith('https') ? 'wss' : 'ws';
  const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `${proto}://${host}/polly/signaling`;
}

// fileKeyringStorage re-implemented locally because polly 0.27.1's
// published bundle erased its node:fs/promises imports under the
// browser build target. The serialise / deserialise helpers still work
// from polly so the wire format stays compatible.
export function keyringStorage(): KeyringStorage {
  const path = KEYRING_PATH;
  return {
    async load(): Promise<MeshKeyring | null> {
      try {
        const text = await readFile(path, 'utf-8');
        return deserialiseKeyring(text);
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
    },
    async save(keyring: MeshKeyring): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      const text = serialiseKeyring(keyring);
      const tmp = `${path}.tmp-${process.pid}`;
      await writeFile(tmp, text, 'utf-8');
      await rename(tmp, path);
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
