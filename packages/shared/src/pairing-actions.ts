// Pairing action handlers — a registry fragment every sub-app spreads
// into its own action registry. Pairing is a mesh-wide concern (every
// sub-app shares the same keyring and peer set), so the same handlers
// run whether the user kicks off pairing from a todo-v2 banner, the
// agenda banner, or family-phone-admin.
//
// The ceremony has two halves — issue this device's token, scan the
// other device's token — and both have to complete for mutual trust.
// Either half may be the first one a device performs. Sharing a link
// issues first and then scans the reply; consuming a link scans first
// and then issues back. pairingStepsRemaining tracks what this device
// still owes and routes the wizard to the next unfinished step after
// each success.

import { decodePairingToken } from '@fairfox/polly/mesh';
import QRCode from 'qrcode';
import { type CustomFrame, subscribeCustomFrames } from '#src/custom-frames.ts';
import {
  addEndorsementToDevice,
  touchSelfDeviceEntry,
  upsertDeviceEntry,
} from '#src/devices-state.ts';
import { mesh } from '#src/ensure-mesh.ts';
import {
  createInvite,
  decodeInviteBlob,
  type InvitePayload,
  verifyInviteSignature,
} from '#src/invite.ts';
import { loadOrCreateKeyring } from '#src/keyring.ts';
import { completePairing, initiatePairing } from '#src/pairing.ts';
import {
  cameraScanMode,
  type InviteRole,
  inviteDraftEnabled,
  inviteDraftName,
  inviteDraftRole,
  inviteIssuedBlob,
  inviteIssuedName,
  issuedQr,
  issuedShareUrl,
  issuedToken,
  issuerWaitingForReturn,
  knownPeerCount,
  type PairingStep,
  pairingError,
  pairingMode,
  pairingSessionId,
  pairingStepsRemaining,
  persistSoloDeviceMode,
  scanInput,
} from '#src/pairing-state.ts';
import {
  createUserIdentity,
  decodeRecoveryBlob,
  exportRecoveryBlob,
  saveUserIdentity,
  signEndorsement,
  type UserIdentity,
} from '#src/user-identity.ts';
import {
  displayNameDraft,
  pendingRecoveryBlob,
  recoveryBlobDraft,
  userIdentity,
  userSetupError,
} from '#src/user-identity-state.ts';
import {
  createBootstrapUser,
  decodeUserPublicKey,
  type Role,
  upsertUser,
  usersState,
} from '#src/users-state.ts';

interface PairingHandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function resetCeremony(): void {
  pairingStepsRemaining.value = new Set();
  issuedToken.value = null;
  issuedQr.value = null;
  issuedShareUrl.value = null;
  scanInput.value = '';
  pairingError.value = null;
  pairingSessionId.value = null;
  issuerWaitingForReturn.value = false;
  unsubscribePairReturn();
}

/** Opaque id that threads the issuer's pair-issue frame through to the
 * matching pair-return frame on the server. Kept separate from polly's
 * pairing token format so no polly release is needed to carry it. */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let pairReturnUnsubscribe: (() => void) | null = null;

function unsubscribePairReturn(): void {
  if (pairReturnUnsubscribe !== null) {
    pairReturnUnsubscribe();
    pairReturnUnsubscribe = null;
  }
}

function subscribeToPairReturn(sessionId: string): void {
  unsubscribePairReturn();
  pairReturnUnsubscribe = subscribeCustomFrames((frame: CustomFrame) => {
    if (frame.type === 'pair-error' && frame.sessionId === sessionId) {
      pairingError.value =
        typeof frame.reason === 'string' ? `Pairing relay: ${frame.reason}` : 'Pairing relay error';
      issuerWaitingForReturn.value = false;
      return;
    }
    if (frame.type !== 'pair-return' || frame.sessionId !== sessionId) {
      return;
    }
    const token = typeof frame.token === 'string' ? frame.token : null;
    if (!token) {
      return;
    }
    const agentHint = typeof frame.agent === 'string' ? frame.agent : null;
    const nameHint = typeof frame.name === 'string' ? frame.name : null;
    // The scanner's reciprocal token completes the ceremony from the
    // issuer's side. Apply it, write a mesh:devices row for the
    // scanner directly (so the UI shows them without waiting for a
    // post-reload WebRTC sync), drain both steps, advance — the
    // remaining logic is identical to the manual-paste path. Before
    // we do `advanceAfter` (which reloads this tab), send the scanner
    // a `pair-ack` frame so a listener like the CLI knows the
    // handshake is complete.
    (async () => {
      try {
        await applyScannedToken(token);
        writeScannerDeviceRow(token, agentHint, nameHint);
        mesh?.signaling.sendCustom('pair-ack', { sessionId });
        drainStep('issue');
        advanceAfter('scan');
      } catch (err) {
        pairingError.value = err instanceof Error ? err.message : String(err);
        issuerWaitingForReturn.value = false;
      }
    })();
  });
}

function drainStep(step: PairingStep): ReadonlySet<PairingStep> {
  const next = new Set(pairingStepsRemaining.value);
  next.delete(step);
  pairingStepsRemaining.value = next;
  return next;
}

function shareUrlForToken(
  token: string,
  sessionId: string | null,
  inviteBlob: string | null
): string {
  const encoded = encodeURIComponent(token);
  const parts: string[] = [`pair=${encoded}`];
  if (sessionId) {
    parts.push(`s=${encodeURIComponent(sessionId)}`);
  }
  if (inviteBlob) {
    parts.push(`invite=${encodeURIComponent(inviteBlob)}`);
  }
  const fragment = parts.join('&');
  if (typeof window === 'undefined') {
    return `#${fragment}`;
  }
  const url = new URL(window.location.href);
  url.hash = fragment;
  return url.toString();
}

/** Build an invite blob from the current draft signals, returning
 * null if the draft is incomplete or the device has no user key /
 * not-admin. Safe to call on every pairing regen — does not mutate
 * mesh state yet; the invitee's UserEntry is only written once they
 * actually accept. */
function maybeCreateInviteBlob(): { blob: string | null; invitedName: string | null } {
  if (!inviteDraftEnabled.value) {
    return { blob: null, invitedName: null };
  }
  const identity = userIdentity.value;
  if (!identity) {
    pairingError.value = 'Set up your own identity before inviting someone else.';
    inviteDraftEnabled.value = false;
    return { blob: null, invitedName: null };
  }
  const adminEntry = usersState.value.users[identity.userId];
  const adminRoles = adminEntry?.roles ?? [];
  if (!adminRoles.includes('admin')) {
    pairingError.value = 'Only admins can invite new users.';
    inviteDraftEnabled.value = false;
    return { blob: null, invitedName: null };
  }
  const name = inviteDraftName.value.trim();
  if (!name) {
    pairingError.value = 'Pick a display name for the person you are inviting.';
    return { blob: null, invitedName: null };
  }
  const role: Role = inviteDraftRole.value;
  const { blob, payload } = createInvite({
    displayName: name,
    roles: [role],
    adminUserKey: identity.keypair,
    adminUserId: identity.userId,
  });
  // Also write the invitee's UserEntry on the admin side so the
  // mesh:users doc gains the row regardless of whether the
  // invitee's own upsertUser survives their post-pair reload. CRDT
  // merge will union the admin's write with the invitee's, so both
  // writing the same row is safe (Automerge merges last-write-wins
  // on the JSON path). Guarding by the role check above ensures we
  // only write rows the current admin is actually allowed to
  // create.
  upsertUser({
    entry: {
      userId: payload.userId,
      displayName: payload.displayName,
      roles: payload.roles,
      grants: payload.grants,
      createdByUserId: payload.createdByUserId,
      createdAt: payload.createdAt,
      signature: payload.signature,
    },
  });
  inviteIssuedBlob.value = blob;
  inviteIssuedName.value = payload.displayName;
  return { blob, invitedName: payload.displayName };
}

async function generateIssueArtefacts(): Promise<void> {
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const token = initiatePairing(keyring, peerId);
  // Register with the server's pair-return relay under a fresh session
  // id, then bake that id into the share URL so the scanner can echo
  // it back through the relay. The mesh signalling connection may not
  // be ready on brand-new devices; if it isn't, fall through with a
  // null sessionId and the manual-paste fallback still covers the
  // ceremony.
  const sessionId = generateSessionId();
  const sent = mesh?.signaling.sendCustom('pair-issue', { sessionId }) ?? false;
  pairingSessionId.value = sent ? sessionId : null;
  issuerWaitingForReturn.value = sent;
  if (sent) {
    subscribeToPairReturn(sessionId);
  }
  const { blob: inviteBlob } = maybeCreateInviteBlob();
  const shareUrl = shareUrlForToken(token, pairingSessionId.value, inviteBlob);
  issuedToken.value = token;
  issuedShareUrl.value = shareUrl;
  try {
    issuedQr.value = await QRCode.toString(shareUrl, { type: 'svg', margin: 1, width: 220 });
  } catch {
    issuedQr.value = null;
  }
}

/** Decode the scanner's pair token and seed a `mesh:devices` row
 * for them locally. Uses the `agent` / `name` hints that rode along
 * on the `pair-return` signalling frame so the row shows up with a
 * sensible label instead of "(unnamed)". Works without waiting for
 * WebRTC sync with the scanner — critical when polly's MeshClient
 * only picks up new peers on reload, which otherwise opens a race
 * window where the scanner could close before any sync completes.
 * CRDT merge resolves any later self-writes the scanner makes
 * cleanly. */
function writeScannerDeviceRow(
  returnToken: string,
  agentHint: string | null,
  nameHint: string | null
): void {
  let decoded: ReturnType<typeof decodePairingToken>;
  try {
    decoded = decodePairingToken(returnToken);
  } catch {
    return;
  }
  const agent: 'cli' | 'browser' | 'extension' =
    agentHint === 'cli' || agentHint === 'extension' ? agentHint : 'browser';
  const peerId = decoded.issuerPeerId;
  const patch: Parameters<typeof upsertDeviceEntry>[1] = {
    agent,
    publicKey: Array.from(decoded.issuerPublicKey),
  };
  if (nameHint) {
    patch.name = nameHint;
  }
  upsertDeviceEntry(peerId, patch);
}

async function applyScannedToken(token: string): Promise<boolean> {
  const keyring = await loadOrCreateKeyring();
  await completePairing(keyring, token);
  knownPeerCount.value = keyring.knownPeers.size;
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  touchSelfDeviceEntry(peerId, { agent: 'browser' });
  return true;
}

function advanceAfter(step: PairingStep): void {
  const remaining = drainStep(step);
  if (remaining.size === 0) {
    pairingMode.value = 'idle';
    issuedToken.value = null;
    issuedQr.value = null;
    issuedShareUrl.value = null;
    scanInput.value = '';
    // The MeshClient constructed at module load captured the keyring's
    // knownPeerIds as they stood then — empty on a first visit, stale on
    // a rejoin. Now that the ceremony has populated the keyring with a
    // new peer, the adapter has no path to discover it short of a fresh
    // module load. A full-page reload is the smallest correct fix: it
    // reconstructs the mesh stack with the new keyring and the
    // peers-present / peer-joined notifications do the rest.
    //
    // A short fence before the reload gives Automerge's IndexedDB
    // storage a chance to flush the pending mesh:users /
    // mesh:devices writes from the invite-accept path. Without it
    // Leo's UserEntry and his device row endorsement can vanish
    // behind the reload — the subsequent post-reload render then
    // shows the synced-from-admin state only, which is missing our
    // own rows. 1 s covers even slow machines without being
    // noticeable; the earlier 200 ms cushion was tuned for a
    // lighter write load and proved too tight for the full
    // users+permissions flow.
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
    return;
  }
  if (remaining.has('issue')) {
    pairingMode.value = 'wizard-issue';
    scanInput.value = '';
    pairingError.value = null;
    if (issuedToken.value === null) {
      void generateIssueArtefacts().catch((err) => {
        pairingError.value = err instanceof Error ? err.message : String(err);
      });
    }
    return;
  }
  pairingMode.value = 'wizard-scan';
  scanInput.value = '';
  pairingError.value = null;
}

interface ParsedHash {
  token: string;
  sessionId: string | null;
  /** Admin-signed invite blob (new user joining the mesh). */
  invite: string | null;
  /** Recovery blob of an existing user (a new device joining THIS
   * user — the "add my phone to my mesh" flow). Mutually exclusive
   * with `invite` at consumption time; if both are present, invite
   * wins because it carries additional role/grant info. */
  recovery: string | null;
}

function readHashParam(body: string, name: string): string | null {
  const prefix = `&${name}=`;
  const idx = body.indexOf(prefix);
  if (idx === -1) {
    return null;
  }
  const start = idx + prefix.length;
  const nextAmp = body.indexOf('&', start);
  const raw = nextAmp === -1 ? body.slice(start) : body.slice(start, nextAmp);
  return decodeURIComponent(raw);
}

/** Forgiving parser for whatever the user pastes into the scan
 * box. Accepts:
 *   - a raw base64 pair token (`UFBUMQEAAAAQ…`)
 *   - a URL-encoded token (`UFBUMQEAAAAQ…%2F…`)
 *   - a token followed by `&s=…` / `&invite=…` / `&recovery=…`
 *     (what you'd copy out of a share URL's fragment body)
 *   - a full share URL with `#pair=…` (whole thing with scheme, or
 *     just the hash)
 * Returns a ParsedHash. Throws only if we can't find a token at
 * all — the eventual `decodePairingToken` call surfaces the real
 * decode error. */
function parseScanPaste(raw: string): ParsedHash {
  const trimmed = raw.trim();
  // Full share URL? Peel off everything up to and including '#pair='.
  const hashIdx = trimmed.indexOf('#pair=');
  if (hashIdx >= 0) {
    const hash = trimmed.slice(hashIdx);
    const parsed = parsePairingHash(hash);
    if (parsed) {
      return parsed;
    }
  }
  // Bare fragment body with pair=… prefix (no leading #)?
  if (trimmed.startsWith('pair=')) {
    const parsed = parsePairingHash(`#${trimmed}`);
    if (parsed) {
      return parsed;
    }
  }
  // Otherwise treat the whole thing as the token itself, stripped
  // of any trailing `&foo=…` query-ish suffix, URI-decoded.
  const ampIdx = trimmed.indexOf('&');
  const tokenPart = ampIdx === -1 ? trimmed : trimmed.slice(0, ampIdx);
  let token: string;
  try {
    token = decodeURIComponent(tokenPart);
  } catch {
    token = tokenPart;
  }
  // Collect sessionId / invite / recovery suffixes if they're
  // present after the first `&`.
  let sessionId: string | null = null;
  let invite: string | null = null;
  let recovery: string | null = null;
  if (ampIdx !== -1) {
    const rest = trimmed.slice(ampIdx);
    sessionId = readHashParam(rest, 's');
    invite = readHashParam(rest, 'invite');
    recovery = readHashParam(rest, 'recovery');
  }
  return { token, sessionId, invite, recovery };
}

function parsePairingHash(hash: string): ParsedHash | null {
  if (!hash.startsWith('#pair=')) {
    return null;
  }
  const body = hash.slice('#'.length);
  const firstAmp = body.indexOf('&');
  const tokenPart = firstAmp === -1 ? body : body.slice(0, firstAmp);
  const token = decodeURIComponent(tokenPart.slice('pair='.length));
  return {
    token,
    sessionId: readHashParam(body, 's'),
    invite: readHashParam(body, 'invite'),
    recovery: readHashParam(body, 'recovery'),
  };
}

let hashListenerInstalled = false;

/** Install a window-level listener that consumes `#pair=…` fragments
 * pasted into an already-open tab. The boot sequence calls this once
 * so MeshGate doesn't need a mount-time effect for the same purpose.
 * Safe to call more than once. */
export function installPairingHashListener(): void {
  if (hashListenerInstalled || typeof window === 'undefined') {
    return;
  }
  hashListenerInstalled = true;
  window.addEventListener('hashchange', () => {
    if (window.location.hash.startsWith('#pair=')) {
      void consumePairingHash();
    }
  });
}

// Consume a `#pair=<token>[&s=<sessionId>][&invite=<blob>]` hash on
// banner mount. Returns true if a token was present and submitted.
// Always clears the fragment from the URL so it doesn't leak further
// into history or bookmarks. When the fragment carries a session id,
// the scanner sends its reciprocal token back through the
// signalling-relayed pair-return frame so the issuer's wizard can
// auto-complete. When it carries an invite, the scanner imports the
// invitee's user key and writes the signed UserEntry into
// `mesh:users` before the post-scan reload — both halves land
// together so the post-reload state is "paired AND known as <name>".
export async function consumePairingHash(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }
  const parsed = parsePairingHash(window.location.hash);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (parsed === null || !parsed.token) {
    return false;
  }
  pairingStepsRemaining.value = new Set<PairingStep>(['issue', 'scan']);
  pairingMode.value = 'wizard-scan';
  scanInput.value = parsed.token;
  pairingError.value = null;
  try {
    await applyScannedToken(parsed.token);
    if (parsed.invite) {
      await acceptInviteBlob(parsed.invite);
    } else if (parsed.recovery) {
      await acceptRecoveryBlob(parsed.recovery);
    }
    if (parsed.sessionId) {
      await sendPairReturnForSession(parsed.sessionId);
      // One-scan completion: when we send a pair-return through the
      // signalling relay, the issuer receives our token and drains
      // their own 'scan' step on receipt. Both halves are therefore
      // done on both sides. Drain our 'issue' step too so the
      // wizard doesn't strand us on a QR nobody will scan —
      // advanceAfter will see remaining.size === 0 and reload into
      // the paired home.
      drainStep('issue');
    }
    advanceAfter('scan');
    return true;
  } catch (err) {
    pairingError.value = err instanceof Error ? err.message : String(err);
    return false;
  }
}

/** Send the scanner's own reciprocal pairing token back to the issuer
 * through the signalling relay. Generated on this device so the issuer
 * can call `applyPairingToken` to add us as a known peer on their side.
 * Best-effort: if the signalling socket isn't connected the scanner
 * falls through and the old manual-paste fallback still works. */
async function sendPairReturnForSession(sessionId: string): Promise<void> {
  if (!mesh) {
    return;
  }
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const returnToken = initiatePairing(keyring, peerId);
  mesh.signaling.sendCustom('pair-return', { sessionId, token: returnToken });
}

/** Accept a recovery blob arriving from the URL fragment — the
 * "add another device to myself" flow. Imports the user key
 * carried in the blob as this device's identity, then
 * self-endorses the device. No UserEntry write: the user already
 * exists in `mesh:users`, and this device joining under the same
 * identity doesn't add a new user row. */
async function acceptRecoveryBlob(blob: string): Promise<void> {
  const identity = decodeRecoveryBlob(blob);
  await saveUserIdentity(identity);
  userIdentity.value = identity;
  // If mesh:users doesn't yet know about this user locally, write a
  // self-signed UserEntry. Two situations hit this:
  //   - CLI minted the mesh but the browser hasn't received the
  //     doc-state sync yet (the CLI may have closed its QR before
  //     the Automerge handshake finished).
  //   - Browser first, CLI second — the browser's identity is
  //     authoritative.
  // CRDT merge handles the duplicate cleanly — the eventual sync
  // from the CLI lands last-write-wins on identical content.
  await usersState.loaded;
  if (!usersState.value.users[identity.userId]) {
    upsertUser({
      entry: createBootstrapUser({
        displayName: identity.displayName,
        userKey: identity.keypair,
      }),
    });
  }
  await selfEndorseDevice(identity);
}

/** Accept an invite blob arriving from the URL fragment. Imports the
 * invitee's user key into this device's keyring, writes their signed
 * `UserEntry` into `mesh:users`, and self-endorses this device on
 * their behalf. The caller is expected to invoke this between
 * `applyScannedToken` and the post-scan reload so both halves land
 * before the page refreshes. */
async function acceptInviteBlob(blob: string): Promise<void> {
  const payload: InvitePayload = decodeInviteBlob(blob);
  // Verify the signature against the admin's public key embedded in
  // the invite — the admin's UserEntry itself may not have synced to
  // this fresh device yet, so deriving the key from the userId is
  // the only path we have at accept time. Phase F will re-verify on
  // accept against mesh:users once it's populated.
  const adminPublicKey = decodeUserPublicKey(payload.createdByUserId);
  if (!adminPublicKey) {
    throw new Error('acceptInviteBlob: admin user id malformed');
  }
  if (!verifyInviteSignature(payload, adminPublicKey)) {
    throw new Error('acceptInviteBlob: invite signature invalid');
  }
  // Import the invitee's user key as this device's new identity.
  const secretKey = new Uint8Array(payload.secretKey);
  const { signingKeyPairFromSecret } = await import('@fairfox/polly/mesh');
  const keypair = signingKeyPairFromSecret(secretKey);
  const identity: UserIdentity = {
    userId: payload.userId,
    displayName: payload.displayName,
    keypair,
  };
  await saveUserIdentity(identity);
  userIdentity.value = identity;
  // Wait for polly's mesh:users doc to hydrate from storage before
  // writing. On a fresh install the storage adapter races the
  // in-memory primitive init; skipping this fence means the write
  // lands, then the empty storage load overwrites it.
  await usersState.loaded;
  // Write the invitee's signed UserEntry so other peers know about
  // the new user. `upsertUser` doesn't verify — that's Phase F's job
  // on the accept hook. The signature we store was produced by the
  // admin; every peer can verify it later against the admin's pubkey.
  upsertUser({
    entry: {
      userId: payload.userId,
      displayName: payload.displayName,
      roles: payload.roles,
      grants: payload.grants,
      createdByUserId: payload.createdByUserId,
      createdAt: payload.createdAt,
      signature: payload.signature,
    },
  });
  await selfEndorseDevice(identity);
}

/** Apply a scanned / pasted value through the same pipeline as the
 * `pairing.submit-scan` action handler. Exported so the in-app camera
 * scanner can feed decoded QR payloads straight in without having to
 * round-trip through the action-dispatch system. */
export async function submitScannedValue(raw: string): Promise<void> {
  const parsed = parseScanPaste(raw);
  try {
    await applyScannedToken(parsed.token);
    if (parsed.invite) {
      await acceptInviteBlob(parsed.invite);
    } else if (parsed.recovery) {
      await acceptRecoveryBlob(parsed.recovery);
    }
    if (parsed.sessionId) {
      await sendPairReturnForSession(parsed.sessionId);
      drainStep('issue');
    }
    advanceAfter('scan');
  } catch (err) {
    pairingError.value = err instanceof Error ? err.message : String(err);
  }
}

/** Apply a raw recovery blob (from paste, scan, or image decode)
 * as this device's user identity. Shared between the
 * `users.import-recovery` paste-box action and the QR scanner
 * dropzone / camera dispatch. Writes a self-signed UserEntry if
 * the mesh doesn't already carry one for this identity, then
 * self-endorses the device row. */
export async function importRecoveryBlob(raw: string): Promise<void> {
  const blob = raw.trim();
  if (!blob) {
    userSetupError.value = 'Paste your recovery blob first.';
    return;
  }
  userSetupError.value = null;
  try {
    const identity = decodeRecoveryBlob(blob);
    await saveUserIdentity(identity);
    if (!usersState.value.users[identity.userId]) {
      upsertUser({
        entry: createBootstrapUser({
          displayName: identity.displayName,
          userKey: identity.keypair,
        }),
      });
    }
    await selfEndorseDevice(identity);
    userIdentity.value = identity;
    recoveryBlobDraft.value = '';
  } catch (err) {
    userSetupError.value = err instanceof Error ? err.message : String(err);
  }
}

export const pairingActions: Record<string, (ctx: PairingHandlerContext) => void> = {
  'pairing.start-issue': () => {
    resetCeremony();
    pairingStepsRemaining.value = new Set<PairingStep>(['issue', 'scan']);
    pairingMode.value = 'wizard-issue';
    void generateIssueArtefacts().catch((err) => {
      pairingError.value = err instanceof Error ? err.message : String(err);
      pairingMode.value = 'idle';
      pairingStepsRemaining.value = new Set();
    });
  },

  'pairing.start-scan': () => {
    resetCeremony();
    pairingStepsRemaining.value = new Set<PairingStep>(['issue', 'scan']);
    pairingMode.value = 'wizard-scan';
  },

  'pairing.issue-done': () => {
    if (!pairingStepsRemaining.value.has('issue')) {
      return;
    }
    advanceAfter('issue');
  },

  'pairing.submit-scan': (ctx) => {
    const raw = ctx.data.value;
    if (!raw) {
      return;
    }
    void submitScannedValue(raw);
  },

  'pairing.cancel': () => {
    resetCeremony();
    pairingMode.value = 'idle';
  },

  'pairing.open-camera': () => {
    cameraScanMode.value = 'pair';
  },

  'pairing.close-camera': () => {
    cameraScanMode.value = null;
  },

  'users.open-recovery-camera': () => {
    cameraScanMode.value = 'recovery';
  },

  'users.close-recovery-camera': () => {
    cameraScanMode.value = null;
  },

  'pairing.start-solo': () => {
    resetCeremony();
    pairingMode.value = 'idle';
    persistSoloDeviceMode(true);
  },

  'users.display-name-input': (ctx) => {
    displayNameDraft.value = ctx.data.value ?? '';
  },

  'users.recovery-blob-input': (ctx) => {
    recoveryBlobDraft.value = ctx.data.value ?? '';
  },

  'users.create-bootstrap': () => {
    const name = displayNameDraft.value.trim();
    if (!name) {
      userSetupError.value = 'Pick a display name first.';
      return;
    }
    userSetupError.value = null;
    (async () => {
      try {
        const identity = await createUserIdentity(name);
        // Wait for polly's mesh:users doc to finish hydrating from
        // storage before deciding whether it's empty. On a fresh
        // install the storage adapter briefly returns an empty doc
        // *after* the first write if we don't fence here — polly
        // races the in-memory primitive init against the async
        // storage load, and the storage load wins if it lands
        // second.
        await usersState.loaded;
        // Write the user row. On a fresh mesh this is the only entry
        // and the user is admin. On a pre-existing mesh without a
        // user registry yet (legacy migration) this still applies —
        // the first writer wins, and whoever bootstraps first becomes
        // the admin. Phase F will add an accept hook that rejects
        // unsigned rows, so the self-signature matters even in
        // lenient mode.
        const existingUserCount = Object.keys(usersState.value.users).length;
        if (existingUserCount === 0) {
          createBootstrapUser({ displayName: name, userKey: identity.keypair });
        } else {
          // A mesh that already has a user registry must not get a
          // second self-signed admin for free — that would let any
          // device promote itself. Fall back to import-recovery or an
          // invite (Phase C). Surface the mismatch.
          userSetupError.value =
            'This mesh already has a user registry. Paste your recovery blob or accept an invite.';
          return;
        }
        await selfEndorseDevice(identity);
        pendingRecoveryBlob.value = exportRecoveryBlob(identity);
        userIdentity.value = identity;
        displayNameDraft.value = '';
      } catch (err) {
        userSetupError.value = err instanceof Error ? err.message : String(err);
      }
    })();
  },

  'users.import-recovery': () => {
    const blob = recoveryBlobDraft.value.trim();
    if (!blob) {
      userSetupError.value = 'Paste your recovery blob first.';
      return;
    }
    void importRecoveryBlob(blob);
  },

  'users.dismiss-recovery-blob': () => {
    pendingRecoveryBlob.value = null;
  },

  'invite.toggle': () => {
    inviteDraftEnabled.value = !inviteDraftEnabled.value;
    // Regenerate the share URL so the invite blob is added or dropped
    // from the fragment in sync with the toggle.
    if (pairingMode.value === 'wizard-issue' && issuedToken.value) {
      void generateIssueArtefacts().catch((err) => {
        pairingError.value = err instanceof Error ? err.message : String(err);
      });
    }
  },

  'invite.name-input': (ctx) => {
    inviteDraftName.value = ctx.data.value ?? '';
    if (pairingMode.value === 'wizard-issue' && issuedToken.value && inviteDraftEnabled.value) {
      void generateIssueArtefacts().catch((err) => {
        pairingError.value = err instanceof Error ? err.message : String(err);
      });
    }
  },

  'invite.role-input': (ctx) => {
    const role = ctx.data.value;
    if (role !== 'admin' && role !== 'member' && role !== 'guest') {
      return;
    }
    const next: InviteRole = role;
    inviteDraftRole.value = next;
    if (pairingMode.value === 'wizard-issue' && issuedToken.value && inviteDraftEnabled.value) {
      void generateIssueArtefacts().catch((err) => {
        pairingError.value = err instanceof Error ? err.message : String(err);
      });
    }
  },
};

/** After a user identity lands, attach it to this device's row in
 * `mesh:devices` so the accept-hook (Phase F) can verify this device
 * acts under a known user. Idempotent — `addEndorsementToDevice`
 * replaces a same-user endorsement rather than stacking duplicates. */
async function selfEndorseDevice(identity: Parameters<typeof signEndorsement>[0]): Promise<void> {
  const keyring = await loadOrCreateKeyring();
  const peerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // Fence on devicesState hydration for the same reason usersState
  // needs it: a fresh-install race between the in-memory primitive
  // init and polly's storage load otherwise drops the write.
  const { devicesState: devState } = await import('#src/devices-state.ts');
  await devState.loaded;
  touchSelfDeviceEntry(peerId, { agent: 'browser' });
  const endorsement = signEndorsement(identity, peerId);
  addEndorsementToDevice(peerId, endorsement);
}
