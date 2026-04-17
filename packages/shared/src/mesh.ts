// Mesh connection factory for fairfox — delegates to polly's createMeshClient,
// which assembles the signalling client, WebRTC adapter, crypto layer, and
// Automerge Repo in one call and calls configureMeshState for us. See ADR 0002.
//
// We keep a thin wrapper so application code speaks in fairfox vocabulary
// (peerId + signalingUrl rather than the polly option tree) and so lifecycle
// is exposed as a synchronous `disconnect` side-effect.

import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import type { MeshClient, MeshKeyring } from '@fairfox/polly/mesh';
import { createMeshClient } from '@fairfox/polly/mesh';

export interface MeshConnection {
  readonly repo: MeshClient['repo'];
  readonly signaling: MeshClient['signaling'];
  disconnect(): void;
}

export interface CreateMeshConnectionOptions {
  keyring: MeshKeyring;
  peerId: string;
  signalingUrl: string;
}

export async function createMeshConnection(
  options: CreateMeshConnectionOptions
): Promise<MeshConnection> {
  const client = await createMeshClient({
    signaling: { url: options.signalingUrl, peerId: options.peerId },
    keyring: options.keyring,
    repoStorage: new IndexedDBStorageAdapter('fairfox-mesh'),
  });
  return {
    repo: client.repo,
    signaling: client.signaling,
    disconnect: () => {
      void client.close();
    },
  };
}
