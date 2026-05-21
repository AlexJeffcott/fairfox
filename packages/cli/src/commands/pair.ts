// `fairfox pair join <url-or-token>` — apply a pairing token to the CLI
// keyring, publish this device's row into the mesh, and complete the
// reciprocal handshake so the issuer trusts this device back.
//
// The join QR/URL carries transport only: `pair=<token>&s=<session>&k=<key>`.
// The identity this device should adopt — a recovery blob for "another of
// my own devices", or an admin-signed invite blob for "a new person" — is
// NOT in the URL. The issuer encrypts it under the ephemeral key `k` and
// hands it back over the relay's pair-ack frame once the handshake
// completes; this CLI decrypts it with `k` and writes user-identity.json.
//
// Why the pair-return matters: pairing is asymmetric. The issuer's token
// carries only the issuer's identity, so until the issuer learns this
// CLI's device pubkey it rejects every op the CLI signs at sync. The
// pair-return frame ships this CLI's own token back through the relay so
// the issuer can applyPairingToken on it.
//
// A bare `fairfox-user-v1:…` recovery blob passed as the argument is
// routed straight to the recovery-import path — the break-glass "I have
// my identity, put it on this machine" entry point.

import { hostname } from 'node:os';
import {
  decodeInviteBlob,
  type InvitePayload,
  verifyInviteSignature,
} from '@fairfox/shared/invite';
import { decryptPairingPayload } from '@fairfox/shared/pairing-payload';
import {
  applyPairingToken,
  createPairingToken,
  DEFAULT_MESH_KEY_ID,
  decodePairingToken,
  encodePairingToken,
  generateDocumentKey,
  generateSigningKeyPair,
  type KeyringStorage,
  type MeshKeyring,
  signingKeyPairFromSecret,
} from '@fairfox/shared/polly';
import { decodeUserPublicKey } from '@fairfox/shared/users-state';
import {
  closeMesh,
  derivePeerId,
  flushOutgoing,
  KEYRING_PATH,
  keyringStorage,
  openMeshClient,
} from '#src/mesh.ts';
import { decodeRecoveryBlob, saveUserIdentityFile } from '#src/user-identity-node.ts';

interface ShareParts {
  readonly pair: string;
  readonly sessionId?: string;
  /** Ephemeral key for decrypting the issuer's pair-ack payload. */
  readonly ackKey?: string;
  /** Legacy / manual fallback: an identity blob carried inline in the
   * URL. New issuers never emit this — they hand identity over the
   * encrypted pair-ack instead. */
  readonly invite?: string;
}

function parseShareInput(input: string): ShareParts {
  const trimmed = input.trim();
  // The fragment portion after `#`, or the raw string if it's already
  // just key=value pairs. Falls through to "treat as raw base64 token"
  // if no `=` is present.
  const fragment = (() => {
    const hashIdx = trimmed.indexOf('#');
    if (hashIdx >= 0) {
      return trimmed.slice(hashIdx + 1);
    }
    if (trimmed.includes('=')) {
      return trimmed;
    }
    return null;
  })();
  if (fragment === null) {
    return { pair: decodeURIComponent(trimmed) };
  }
  const params = new URLSearchParams(fragment);
  const pair = params.get('pair');
  const sessionId = params.get('s') ?? undefined;
  const ackKey = params.get('k') ?? undefined;
  const invite = params.get('invite') ?? undefined;
  if (!pair) {
    // No `pair=` field — treat the whole fragment as the bare token.
    return { pair: decodeURIComponent(fragment) };
  }
  return {
    pair,
    ...(sessionId ? { sessionId } : {}),
    ...(ackKey ? { ackKey } : {}),
    ...(invite ? { invite } : {}),
  };
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

/** Decode an admin-signed invite blob, verify its signature against the
 * admin pubkey embedded in the payload, and write the invitee's user key
 * as this device's identity. Returns the display name on success. */
function applyInviteBlob(blob: string): string {
  let payload: InvitePayload;
  try {
    payload = decodeInviteBlob(blob);
  } catch (err) {
    throw new Error(`invite decode failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const adminPublicKey = decodeUserPublicKey(payload.createdByUserId);
  if (!adminPublicKey) {
    throw new Error('invite admin user id malformed');
  }
  if (!verifyInviteSignature(payload, adminPublicKey)) {
    throw new Error('invite signature invalid');
  }
  const keypair = signingKeyPairFromSecret(new Uint8Array(payload.secretKey));
  saveUserIdentityFile({
    userId: payload.userId,
    displayName: payload.displayName,
    keypair,
  });
  return payload.displayName;
}

/** Apply whatever identity blob the issuer handed back — a recovery blob
 * (`fairfox-user-v1:…`) or an admin-signed invite blob. Writes
 * user-identity.json. Returns a short human description. Throws on a
 * malformed or unverifiable blob. */
function applyIdentityBlob(blob: string): string {
  const trimmed = blob.trim();
  if (trimmed.startsWith('fairfox-user-v1')) {
    const identity = decodeRecoveryBlob(trimmed);
    saveUserIdentityFile(identity);
    return `recovered identity "${identity.displayName}"`;
  }
  return `adopted invited identity "${applyInviteBlob(trimmed)}"`;
}

function parseArgs(rest: readonly string[]): {
  token: string | undefined;
  sessionId: string | undefined;
} {
  let token: string | undefined;
  let sessionId: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--session' || arg === '-s') {
      sessionId = rest[i + 1];
      i += 1;
    } else if (arg && !token) {
      token = arg;
    }
  }
  return { token, sessionId };
}

export async function pair(tokenInputOrArgs: string | readonly string[]): Promise<number> {
  const rest = typeof tokenInputOrArgs === 'string' ? [tokenInputOrArgs] : tokenInputOrArgs;
  const { token: tokenInput, sessionId: sessionIdArg } = parseArgs(rest);
  if (!tokenInput) {
    process.stderr.write(
      'fairfox pair join: expected a join URL, pairing token, or recovery blob.\n'
    );
    return 1;
  }

  // A bare recovery blob is the break-glass "I have my identity, put it
  // on this machine" path — route it to the recovery import directly.
  const trimmed = tokenInput.trim();
  if (trimmed.startsWith('fairfox-user-v1:') || trimmed.startsWith('fairfox-user-v1%3A')) {
    const { usersImport } = await import('#src/commands/users.ts');
    return usersImport(trimmed);
  }

  const shareParts = parseShareInput(tokenInput);
  const sessionId = sessionIdArg ?? shareParts.sessionId;
  const ackKey = shareParts.ackKey;

  const storage = keyringStorage();
  const keyring = await loadOrCreateKeyring(storage);

  let decoded: ReturnType<typeof decodePairingToken>;
  try {
    decoded = decodePairingToken(shareParts.pair);
  } catch (err) {
    process.stderr.write(
      `fairfox pair join: could not decode token — ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }

  applyPairingToken(decoded, keyring);
  await storage.save(keyring);

  // Legacy / manual fallback: an identity blob carried inline in the URL.
  // New issuers never do this, but a hand-pasted old URL still works.
  let identityApplied: string | null = null;
  if (shareParts.invite) {
    try {
      identityApplied = `adopted invited identity "${applyInviteBlob(shareParts.invite)}"`;
    } catch (err) {
      process.stderr.write(
        `fairfox pair join: invite blob rejected — ${err instanceof Error ? err.message : String(err)}\n`
      );
      return 1;
    }
  }

  // Mint our own pair token. We ship it to the issuer as a pair-return
  // frame so they add us to *their* keyring — without that reciprocal
  // apply the issuer rejects every op we sign at sync.
  const ownPeerId = derivePeerId(keyring.identity.publicKey);
  const documentKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
  const ownEncoded = encodePairingToken(
    createPairingToken({
      identity: keyring.identity,
      issuerPeerId: ownPeerId,
      documentKey,
      documentKeyId: DEFAULT_MESH_KEY_ID,
    })
  );

  // Open the mesh, ship the pair-return, and wait for the issuer's
  // pair-ack. The ack both confirms the handshake completed and (for a
  // fresh join) carries the encrypted identity blob.
  const ACK_TIMEOUT_MS = 12000;
  try {
    let gotAck = false;
    let ackResolve: (() => void) | undefined;
    const ackWait = new Promise<void>((resolve) => {
      ackResolve = resolve;
    });
    const client = await openMeshClient({
      peerId: ownPeerId,
      onCustomFrame: (frame) => {
        if (frame.type !== 'pair-ack' || frame.sessionId !== sessionId) {
          return;
        }
        gotAck = true;
        const payload = typeof frame.payload === 'string' ? frame.payload : null;
        if (payload && ackKey && identityApplied === null) {
          try {
            identityApplied = applyIdentityBlob(decryptPairingPayload(payload, ackKey));
          } catch (err) {
            process.stderr.write(
              `fairfox pair join: identity hand-off failed — ${err instanceof Error ? err.message : String(err)}\n`
            );
          }
        }
        ackResolve?.();
      },
    });
    try {
      if (sessionId) {
        const sent = client.signaling.sendCustom('pair-return', {
          sessionId,
          token: ownEncoded,
          agent: 'cli',
          name: hostname(),
        });
        if (!sent) {
          process.stderr.write(
            'fairfox pair join: could not reach the signalling relay — the issuer will have to paste your token manually (printed below).\n'
          );
        }
      }
      const timeout = new Promise<void>((r) => setTimeout(r, ACK_TIMEOUT_MS));
      await Promise.race([ackWait, timeout]);
      if (!gotAck && sessionId) {
        process.stderr.write(
          'fairfox pair join: no pair-ack from the issuer — closing anyway. The keyring is paired; if an identity was expected, ask the issuer to reopen the QR.\n'
        );
      }
      await flushOutgoing(500);
    } finally {
      await closeMesh(client);
    }
  } catch {
    // Pairing already succeeded — the self-row publish and pair-return
    // are convenience; a later command re-publishes.
  }

  const lines = [
    `Paired. Keyring written to ${KEYRING_PATH}.`,
    identityApplied ? `Identity: ${identityApplied}.` : '',
    '',
    sessionId
      ? 'Sent a pair-return frame to the issuer.'
      : 'Now give the other device this URL so it can scan you back:',
    '',
    `  #pair=${encodeURIComponent(ownEncoded)}`,
  ].filter((line) => line !== '');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
