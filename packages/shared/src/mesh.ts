// Mesh connection factory for fairfox — wires up the full transport stack
// (signaling client → WebRTC adapter → crypto adapter → Repo) and calls
// configureMeshState so that $meshState() primitives in sub-apps work
// against the connected Repo. See ADR 0002.
//
// The signaling URL is read from the FAIRFOX_SIGNALING_URL environment
// variable (set in Railway and in the local .env). The function returns
// the configured Repo and the signaling client so callers can manage
// lifecycle (disconnect on unmount, reconnect on visibility change).

import type { Repo } from '@automerge/automerge-repo';
import type { MeshKeyring } from '@fairfox/polly/mesh';
import {
  configureMeshState,
  MeshNetworkAdapter,
  MeshSignalingClient,
  MeshWebRTCAdapter,
} from '@fairfox/polly/mesh';

export interface MeshConnection {
  readonly repo: Repo;
  readonly signaling: MeshSignalingClient;
  disconnect(): void;
}

export interface CreateMeshConnectionOptions {
  keyring: MeshKeyring;
  peerId: string;
  signalingUrl: string;
  knownPeerIds?: string[];
}

export function createMeshConnection(options: CreateMeshConnectionOptions): MeshConnection {
  const { keyring, peerId, signalingUrl, knownPeerIds } = options;

  const signaling = new MeshSignalingClient({
    url: signalingUrl,
    peerId,
    onSignal: (fromPeerId: string, payload: unknown) => {
      webrtcAdapter.handleSignal(fromPeerId, payload);
    },
  });

  const webrtcAdapter = new MeshWebRTCAdapter({
    signaling,
    peerId,
    knownPeerIds,
  });

  const meshAdapter = new MeshNetworkAdapter({
    base: webrtcAdapter,
    keyring,
  });

  // Dynamic import to avoid pulling automerge-repo into the server bundle
  // when only the signaling server is needed. The Repo constructor is only
  // called on the client side.
  const { Repo: RepoClass } = require('@automerge/automerge-repo');
  const repo: Repo = new RepoClass({ network: [meshAdapter] });
  configureMeshState(repo);

  const disconnect = (): void => {
    meshAdapter.disconnect();
    signaling.close();
  };

  return { repo, signaling, disconnect };
}
