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
import { dispatchCustomFrame } from '#src/custom-frames.ts';
import { markPeersPresent, resetPeersPresent } from '#src/peers-presence.ts';

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

/** How often to refresh the peer-presence signal. Polling is tolerable
 * for v1 because polly's `MeshClient` doesn't expose reactive presence
 * callbacks through its top-level options; the `MeshSignalingClient`
 * does, but the client owns them internally. A two-second tick is
 * fast enough that a freshly-joined peer shows up on the peer list in
 * about the same time the browser would render a hover state, and
 * slow enough that idle devices aren't doing polling work. */
const PRESENCE_POLL_MS = 2_000;

export async function createMeshConnection(
  options: CreateMeshConnectionOptions
): Promise<MeshConnection> {
  const client = await createMeshClient({
    signaling: {
      url: options.signalingUrl,
      peerId: options.peerId,
      onCustomFrame: (frame) => {
        dispatchCustomFrame(frame);
      },
    },
    keyring: options.keyring,
    repoStorage: new IndexedDBStorageAdapter('fairfox-mesh'),
  });
  const poll = setInterval(() => {
    markPeersPresent(client.repo.peers);
  }, PRESENCE_POLL_MS);
  // Prime the signal immediately so the initial render doesn't show
  // every paired peer as offline for two seconds while the first tick
  // arrives.
  markPeersPresent(client.repo.peers);
  return {
    repo: client.repo,
    signaling: client.signaling,
    disconnect: () => {
      clearInterval(poll);
      resetPeersPresent();
      void client.close();
    },
  };
}
