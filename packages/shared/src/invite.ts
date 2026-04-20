// Invite tokens — the payload that onboards a new user into the mesh
// in one shot. An admin device generates an invite for an invitee:
// fresh user keypair + display name + role set, all signed by the
// admin's user key. The invite blob rides along with the pairing
// token in the share URL's fragment (`#pair=<tok>&s=<sid>&invite=<blob>`)
// and is consumed by the scanner's login page, which imports the
// user key into its keyring, self-endorses the device, and lets the
// normal pairing ceremony complete the mesh-level handshake.
//
// The invite carries the invitee's *private* key, which is why the
// share URL must travel over a channel the admin trusts (QR scanned
// directly, or a private message). Treat the blob like a password.
// Phase F's accept hook verifies the admin's signature before any
// peer admits the new UserEntry; the invitee can't silently promote
// the wrong role because the signed role set is part of what's
// verified.

import { isRecord } from '@fairfox/polly/guards';
import { generateSigningKeyPair, type SigningKeyPair, sign, verify } from '@fairfox/polly/mesh';
import { encodePublicKeyHex, type Grant, type Role } from '#src/users-state.ts';

const INVITE_PREFIX = 'fairfox-invite-v1';

export interface InvitePayload {
  /** Hex userId of the invitee — derived from publicKey. */
  userId: string;
  /** 64-byte secret key of the invitee, as number[] for JSON-safe
   * transport. The invitee imports this into their keyring and
   * discards the blob. */
  secretKey: number[];
  displayName: string;
  roles: Role[];
  grants: Grant[];
  /** The admin's userId that signed this invite. */
  createdByUserId: string;
  createdAt: string;
  /** Signature by the admin's user key over
   * `{ userId, roles, grants, createdByUserId, createdAt, displayName }`. */
  signature: number[];
}

function encodeInviteForSigning(
  payload: Pick<
    InvitePayload,
    'userId' | 'displayName' | 'roles' | 'grants' | 'createdByUserId' | 'createdAt'
  >
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      userId: payload.userId,
      displayName: payload.displayName,
      roles: payload.roles,
      grants: payload.grants,
      createdByUserId: payload.createdByUserId,
      createdAt: payload.createdAt,
    })
  );
}

export interface CreateInviteOptions {
  displayName: string;
  roles: Role[];
  grants?: Grant[];
  adminUserKey: SigningKeyPair;
  adminUserId: string;
}

/** Generate a fresh user keypair for the invitee, sign the invite
 * envelope with the admin's key, and return both the encoded blob
 * (for the share URL) and the raw payload (for the admin to display
 * "you just invited X" confirmation). */
export function createInvite(options: CreateInviteOptions): {
  blob: string;
  payload: InvitePayload;
} {
  const invitee = generateSigningKeyPair();
  const userId = encodePublicKeyHex(invitee.publicKey);
  const createdAt = new Date().toISOString();
  const grants = options.grants ?? [];
  const draft = {
    userId,
    displayName: options.displayName,
    roles: options.roles,
    grants,
    createdByUserId: options.adminUserId,
    createdAt,
  };
  const signature = sign(encodeInviteForSigning(draft), options.adminUserKey.secretKey);
  const payload: InvitePayload = {
    ...draft,
    secretKey: Array.from(invitee.secretKey),
    signature: Array.from(signature),
  };
  const blob = encodeInviteBlob(payload);
  return { blob, payload };
}

/** Encode an invite payload to a URL-safe base64 blob prefixed with
 * the version tag. */
export function encodeInviteBlob(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${INVITE_PREFIX}:${b64}`;
}

/** Decode an invite blob without verifying the signature. Throws on
 * malformed input. Callers should always follow up with
 * `verifyInvite` before persisting anything. */
export function decodeInviteBlob(blob: string): InvitePayload {
  if (!blob.startsWith(`${INVITE_PREFIX}:`)) {
    throw new Error('decodeInviteBlob: wrong prefix or version');
  }
  const b64 = blob
    .slice(INVITE_PREFIX.length + 1)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('decodeInviteBlob: base64 decode failed');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const json = new TextDecoder().decode(bytes);
  const parsed: unknown = JSON.parse(json);
  if (!isInvitePayloadShape(parsed)) {
    throw new Error('decodeInviteBlob: payload failed shape check');
  }
  return parsed;
}

function isInvitePayloadShape(value: unknown): value is InvitePayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.userId === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.secretKey) &&
    Array.isArray(value.roles) &&
    Array.isArray(value.grants) &&
    typeof value.createdByUserId === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.signature)
  );
}

/** Verify that the invite's signature was produced by the admin's
 * user key. Returns true on success. Does NOT verify that the admin
 * exists in `mesh:users` or holds `user.invite` — the caller is
 * responsible for that richer check (Phase F accept hook). */
export function verifyInviteSignature(payload: InvitePayload, adminPublicKey: Uint8Array): boolean {
  if (payload.signature.length === 0) {
    return false;
  }
  return verify(encodeInviteForSigning(payload), new Uint8Array(payload.signature), adminPublicKey);
}
