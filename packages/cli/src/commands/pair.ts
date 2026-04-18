// `fairfox pair <token>` — apply a pairing token to the CLI keyring and
// print this device's own share URL so the browser side can scan it
// back. The token argument accepts either a bare base64 payload or a
// `#pair=<encoded>` fragment lifted from a share URL; either shape
// round-trips through `decodePairingToken` after a URL-decode.
//
// No network traffic at this stage — pairing is a pure keyring
// mutation. The reciprocal "scan" from the browser side happens later,
// when the browser's own mesh client sees the CLI on the signalling
// server. This command's only I/O is reading/writing the keyring file.

import {
  applyPairingToken,
  createPairingToken,
  DEFAULT_MESH_KEY_ID,
  decodePairingToken,
  encodePairingToken,
  generateDocumentKey,
  generateSigningKeyPair,
  type MeshKeyring,
} from '@fairfox/polly/mesh';
import type { KeyringStorage } from '@fairfox/polly/mesh/node';
import { derivePeerId, KEYRING_PATH, keyringStorage } from '#src/mesh.ts';

function extractToken(input: string): string {
  const trimmed = input.trim();
  const hashIndex = trimmed.indexOf('#pair=');
  if (hashIndex >= 0) {
    return decodeURIComponent(trimmed.slice(hashIndex + '#pair='.length));
  }
  if (trimmed.startsWith('pair=')) {
    return decodeURIComponent(trimmed.slice('pair='.length));
  }
  return decodeURIComponent(trimmed);
}

async function loadOrCreateKeyring(storage: KeyringStorage): Promise<MeshKeyring> {
  const existing = await storage.load();
  if (existing) {
    return existing;
  }
  const fresh: MeshKeyring = {
    identity: generateSigningKeyPair(),
    knownPeers: new Map(),
    documentKeys: new Map([[DEFAULT_MESH_KEY_ID, generateDocumentKey()]]),
    revokedPeers: new Set<string>(),
  };
  await storage.save(fresh);
  return fresh;
}

export async function pair(tokenInput: string): Promise<number> {
  const storage = keyringStorage();
  const keyring = await loadOrCreateKeyring(storage);
  const encoded = extractToken(tokenInput);

  let decoded: ReturnType<typeof decodePairingToken>;
  try {
    decoded = decodePairingToken(encoded);
  } catch (err) {
    process.stderr.write(
      `fairfox pair: could not decode token — ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }

  applyPairingToken(decoded, keyring);
  await storage.save(keyring);

  // Mint our own share URL so the user can paste it into the browser's
  // Step 2 to complete the asymmetric ceremony.
  const ownPeerId = derivePeerId(keyring.identity.publicKey);
  const documentKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
  const ownToken = createPairingToken({
    identity: keyring.identity,
    issuerPeerId: ownPeerId,
    documentKey,
    documentKeyId: DEFAULT_MESH_KEY_ID,
  });
  const ownEncoded = encodePairingToken(ownToken);

  process.stdout.write(
    [
      `Paired. Keyring written to ${KEYRING_PATH}.`,
      '',
      'Now give the other device this URL so it can scan you back:',
      '',
      `  #pair=${encodeURIComponent(ownEncoded)}`,
      '',
      'Or the raw token, if you prefer:',
      '',
      `  ${ownEncoded}`,
      '',
    ].join('\n')
  );
  return 0;
}
