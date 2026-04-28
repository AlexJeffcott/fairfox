// Re-export polly's public surface the CLI reaches for. Keeping the
// CLI's `@fairfox/polly` import chain routed through @fairfox/shared
// collapses bun's workspace resolution to one copy — otherwise cli
// and shared each get their own polly instance in node_modules, and
// the module-global Repo set by one isn't visible to the other.
// Result: `devicesState.loaded` in a CLI command throws
// "no Repo configured" even after `openMeshClient` has run.

// Re-export the bare Repo so storage-only readers (the doctor)
// can open the same docs as a running mesh client without
// joining the signalling network — same keyring would otherwise
// produce a peerId clash that kicks the running relay off.
export { Repo } from '@automerge/automerge-repo/slim';
export { isRecord } from '@fairfox/polly/guards';
export {
  $meshState,
  applyPairingToken,
  configureMeshState,
  createMeshClient,
  createPairingToken,
  DEFAULT_MESH_KEY_ID,
  decodePairingToken,
  encodePairingToken,
  generateDocumentKey,
  generateSigningKeyPair,
  type MeshClient,
  type MeshKeyring,
  revokePeerLocally,
  type SigningKeyPair,
  signingKeyPairFromSecret,
} from '@fairfox/polly/mesh';
export { fileKeyringStorage, type KeyringStorage } from '@fairfox/polly/mesh/node';
