// Pre-boot side-effect module that configures the mesh Repo before any
// $meshState primitive is declared. Every sub-app's state.ts imports this
// file, so ESM's guaranteed module-init order — top-level await included —
// runs configureMeshState before the state module body evaluates.
//
// Without this, state.ts would call $meshState(...) at module top level and
// polly's resolveRepo() would throw because boot.tsx had not yet had a
// chance to set up the Repo.

import { loadOrCreateKeyring } from '#src/keyring.ts';
import { createMeshConnection, type MeshConnection } from '#src/mesh.ts';

async function setup(): Promise<MeshConnection | undefined> {
  if (typeof window === 'undefined') {
    // Test and server environments configure their own Repo directly via
    // configureMeshState; there is no browser keyring or signaling URL to
    // read here.
    return undefined;
  }

  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const signalingUrl = `${proto}//${window.location.host}/polly/signaling`;

  return await createMeshConnection({ keyring, peerId, signalingUrl });
}

export const mesh: MeshConnection | undefined = await setup();
