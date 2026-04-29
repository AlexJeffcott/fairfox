// `fairfox pair <token> [--session <sid>]` — apply a pairing token to
// the CLI keyring, publish this device's row into the mesh, and
// (optionally) send the issuer a pair-return frame so their browser
// tab learns the CLI's identity.
//
// The token argument accepts either a bare base64 payload or a
// `#pair=<encoded>` fragment lifted from a share URL; either shape
// round-trips through `decodePairingToken` after a URL-decode.
//
// Why the pair-return matters: pairing is asymmetric. The token the
// issuer emits carries only the issuer's identity, so after the CLI
// applies it the *CLI* trusts the laptop but the laptop knows nothing
// about the CLI. Until the laptop learns the CLI's device pubkey, it
// rejects every op the CLI signs at sync — the CLI stays invisible in
// the laptop's peers list, even though the pair "succeeded". The
// pair-return path mirrors the browser-to-browser ceremony: the CLI
// mints its own pair token, sends it back through the signalling
// relay against the issuer's session id, and the issuer's
// pair-return handler calls applyPairingToken on that token.

import { hostname } from 'node:os';
import {
  decodeInviteBlob,
  type InvitePayload,
  verifyInviteSignature,
} from '@fairfox/shared/invite';
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
import { saveUserIdentityFile } from '#src/user-identity-node.ts';

interface ShareParts {
  readonly pair: string;
  readonly sessionId?: string;
  readonly invite?: string;
}

function parseShareInput(input: string): ShareParts {
  const trimmed = input.trim();
  // The fragment portion after `#`, or the raw string if it's
  // already just key=value pairs. Falls through to "treat as raw
  // base64 token" if no `=` is present.
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
  const invite = params.get('invite') ?? undefined;
  if (!pair) {
    // No `pair=` field — treat the whole fragment as the bare
    // token (the older single-value form `pair=XXX`).
    return { pair: decodeURIComponent(fragment) };
  }
  return {
    pair,
    ...(sessionId ? { sessionId } : {}),
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

interface InviteApplyOk {
  readonly kind: 'ok';
  readonly displayName: string;
  readonly payload: InvitePayload;
}
interface InviteApplyError {
  readonly kind: 'error';
  readonly message: string;
}

/** Mirror of pairing-actions.ts:`acceptInviteBlob` for the CLI.
 * Decodes the admin-signed invite blob, verifies the signature
 * against the admin's pubkey embedded in the payload, imports the
 * invitee's user key as this device's identity, and writes
 * user-identity.json. The corresponding UserEntry write into
 * mesh:users happens when openMeshClient runs below — we can't
 * upsertUser here because polly's $meshState needs the Repo
 * configured. */
function applyInviteBlob(blob: string): InviteApplyOk | InviteApplyError {
  let payload: InvitePayload;
  try {
    payload = decodeInviteBlob(blob);
  } catch (err) {
    return {
      kind: 'error',
      message: `decode failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const adminPublicKey = decodeUserPublicKey(payload.createdByUserId);
  if (!adminPublicKey) {
    return { kind: 'error', message: 'admin user id malformed' };
  }
  if (!verifyInviteSignature(payload, adminPublicKey)) {
    return { kind: 'error', message: 'invite signature invalid' };
  }
  const secretKey = new Uint8Array(payload.secretKey);
  const keypair = signingKeyPairFromSecret(secretKey);
  saveUserIdentityFile({
    userId: payload.userId,
    displayName: payload.displayName,
    keypair,
  });
  return { kind: 'ok', displayName: payload.displayName, payload };
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
    process.stderr.write('fairfox pair: expected a pairing token or URL as the first argument.\n');
    return 1;
  }

  // Share URLs from `mesh invite open` carry pair=, s=, and invite=
  // chained with `&` after the `#`. parseShareInput extracts each so
  // a single positional argument carries the full ceremony — matching
  // the browser flow where the URL hash drives everything.
  const shareParts = parseShareInput(tokenInput);
  const sessionId = sessionIdArg ?? shareParts.sessionId;
  const inviteBlob = shareParts.invite;

  const storage = keyringStorage();
  const keyring = await loadOrCreateKeyring(storage);

  let decoded: ReturnType<typeof decodePairingToken>;
  try {
    decoded = decodePairingToken(shareParts.pair);
  } catch (err) {
    process.stderr.write(
      `fairfox pair: could not decode token — ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }

  applyPairingToken(decoded, keyring);
  await storage.save(keyring);

  // If the share URL also carried an invite blob, apply it: import
  // the invitee's user key as this CLI's identity and mint the
  // corresponding UserEntry. Mirrors `acceptInviteBlob` in the
  // browser pairing-actions.ts. Without this the CLI is paired but
  // has no user identity, and `chat send` / `users invite` /
  // anything that signs as a user fails.
  if (inviteBlob) {
    const inviteResult = applyInviteBlob(inviteBlob);
    if (inviteResult.kind === 'error') {
      process.stderr.write(`fairfox pair: invite blob rejected — ${inviteResult.message}\n`);
      return 1;
    }
    process.stdout.write(`fairfox pair: adopted invitee identity "${inviteResult.displayName}"\n`);
  }

  // Mint our own pair token BEFORE we open the mesh. We'll both
  // print it (for manual paste) and, if we have a session id, ship
  // it to the issuer as a pair-return frame so they add us to
  // *their* keyring. Without that reciprocal apply the laptop stays
  // blind to the CLI's identity and every op we sign gets rejected
  // at sync.
  const ownPeerId = derivePeerId(keyring.identity.publicKey);
  const documentKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
  const ownToken = createPairingToken({
    identity: keyring.identity,
    issuerPeerId: ownPeerId,
    documentKey,
    documentKeyId: DEFAULT_MESH_KEY_ID,
  });
  const ownEncoded = encodePairingToken(ownToken);

  // Open the mesh, publish the CLI's mesh:devices row, and ship the
  // pair-return frame. Then wait for an explicit `pair-ack` from the
  // issuer's tab rather than a blind timer: the ack fires in the
  // issuer's `subscribeToPairReturn` after it calls
  // applyScannedToken, so when the CLI sees it we know the issuer
  // has added our identity to its keyring and the handshake is
  // complete. The safety-net timeout is there only for the case
  // where signalling is unreachable or the issuer's tab was closed —
  // it's not the happy path.
  //
  // `openMeshClient` awaits devicesState.loaded and writes the self-
  // row as a side effect on open.
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
        if (frame.type === 'pair-ack' && frame.sessionId === sessionId) {
          gotAck = true;
          ackResolve?.();
        }
      },
    });
    try {
      if (sessionId) {
        // Hand the issuer everything it needs to write our
        // mesh:devices row directly, so the UI shows us immediately
        // without depending on a post-reload WebRTC sync that
        // polly's current adapter can't promise in a tight window.
        const sent = client.signaling.sendCustom('pair-return', {
          sessionId,
          token: ownEncoded,
          agent: 'cli',
          name: hostname(),
        });
        if (!sent) {
          process.stderr.write(
            'fairfox pair: could not reach the signalling relay — the issuer will have to paste your token manually (printed below).\n'
          );
        }
      }
      // Wait for ack (proof the issuer applied our token and wrote
      // our mesh:devices row). No arbitrary hold after that — the
      // issuer's row-write is what matters, and it's already done by
      // the time the ack arrives. A small flush lets any pending
      // local Automerge writes settle before teardown.
      const timeout = new Promise<void>((r) => setTimeout(r, ACK_TIMEOUT_MS));
      await Promise.race([ackWait, timeout]);
      if (!gotAck && sessionId) {
        process.stderr.write(
          'fairfox pair: no pair-ack from the issuer — closing anyway. If their pair tab was open, the row may still land.\n'
        );
      }
      await flushOutgoing(500);
    } finally {
      await closeMesh(client);
    }
  } catch {
    // Pair already succeeded — the self-row publish and pair-return
    // are convenience; a later command will re-publish and the user
    // can still hand-paste the printed token.
  }

  process.stdout.write(
    [
      `Paired. Keyring written to ${KEYRING_PATH}.`,
      '',
      sessionId
        ? "Sent a pair-return frame to the issuer. If their tab was open and the signalling relay was up, they've already added this CLI to their keyring."
        : 'Now give the other device this URL so it can scan you back:',
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
