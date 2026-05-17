// `fairfox mesh …` — the named-mesh lifecycle commands. Init,
// invite list, invite open (live QR), invite close (implicit on
// ctrl-c). Collapses the "start a new mesh" path onto one
// deliberate verb so existing mesh state can't be clobbered by a
// tab that happened to open first.
//
// Lifetime invariants of an invite:
//   - blob (user key + admin signature):  persists in ~/.fairfox/invites.json.
//   - pair-token + session id:            born at `invite open`, dies at close.
//   - "consumed":                          derived from mesh:devices endorsing the userId.

import { existsSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import type { ChatHealth, LeaderLease } from '@fairfox/shared/assistant-state';
import type { DevicesDoc } from '@fairfox/shared/devices-state';
import {
  addEndorsementToDevice,
  devicesState,
  touchSelfDeviceEntry,
  upsertDeviceEntry,
} from '@fairfox/shared/devices-state';
import { createInvite } from '@fairfox/shared/invite';
import { awaitLoadedBudget } from '@fairfox/shared/loaded-budget';
import {
  generateMeshName,
  meshFingerprint,
  meshMetaState,
  setMeshName,
} from '@fairfox/shared/mesh-meta-state';
import {
  $meshState,
  applyPairingToken,
  createPairingToken,
  DEFAULT_MESH_KEY_ID,
  decodePairingToken,
  encodePairingToken,
  generateDocumentKey,
  generateSigningKeyPair,
  type MeshClient,
  type MeshKeyring,
} from '@fairfox/shared/polly';
import { signEndorsement } from '@fairfox/shared/user-identity';
import {
  createBootstrapUser,
  type Role,
  upsertUser,
  usersState,
} from '@fairfox/shared/users-state';
import QRCode from 'qrcode';
import {
  addInvite,
  clearInvitesFile,
  findInvite,
  loadInvitesFile,
  type StoredInvite,
} from '#src/invites-node.ts';
import {
  closeMesh,
  derivePeerId,
  flushOutgoing,
  KEYRING_PATH,
  keyringStorage,
  openMeshClient,
  openMeshClientReadOnly,
  waitForPeer,
} from '#src/mesh.ts';

import {
  clearUserIdentityFile,
  createUserIdentityFile,
  exportRecoveryBlob,
  loadUserIdentityFile,
  USER_IDENTITY_PATH,
} from '#src/user-identity-node.ts';

const DEVICES_INITIAL: DevicesDoc = { devices: {} };

interface InitUser {
  name: string;
  role: Role;
}

interface InitArgs {
  admin: string | undefined;
  name: string | undefined;
  users: InitUser[];
  force: boolean;
}

function isValidRole(s: string): s is Role {
  return s === 'admin' || s === 'member' || s === 'guest' || s === 'llm';
}

function parseInitArgs(rest: readonly string[]): InitArgs {
  const args: InitArgs = { admin: undefined, name: undefined, users: [], force: false };
  // Positional mesh-name: the first non-flag token is the mesh name.
  // The legacy --name flag is still honoured for callers that haven't
  // migrated yet, but the positional shape (`fairfox init <name>`) is
  // the documented one.
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--force') {
      args.force = true;
    } else if (arg === '--admin') {
      args.admin = rest[i + 1];
      i += 1;
    } else if (arg === '--name') {
      args.name = rest[i + 1];
      i += 1;
    } else if (arg === '--user') {
      const raw = rest[i + 1];
      i += 1;
      if (!raw) {
        continue;
      }
      const [name, role] = raw.split(':');
      if (!name || !role || !isValidRole(role)) {
        continue;
      }
      args.users.push({ name, role });
    } else if (!arg.startsWith('-') && args.name === undefined) {
      args.name = arg;
    }
  }
  return args;
}

function wipeLocalState(): void {
  if (existsSync(KEYRING_PATH)) {
    unlinkSync(KEYRING_PATH);
  }
  clearUserIdentityFile();
  clearInvitesFile();
}

export async function meshInit(rest: readonly string[]): Promise<number> {
  const args = parseInitArgs(rest);
  if (!args.admin || !args.admin.trim()) {
    process.stderr.write(
      'fairfox mesh init: --admin <name> is required. Example:\n' +
        '  fairfox mesh init --admin "Alex" --user "Leo:guest"\n'
    );
    return 1;
  }
  const adminName = args.admin.trim();

  const keyringExists = existsSync(KEYRING_PATH);
  const userIdentityExists = existsSync(USER_IDENTITY_PATH);
  if ((keyringExists || userIdentityExists) && !args.force) {
    process.stderr.write(
      [
        'fairfox mesh init: local state already exists.',
        `  keyring:       ${KEYRING_PATH}${keyringExists ? ' (present)' : ''}`,
        `  user identity: ${USER_IDENTITY_PATH}${userIdentityExists ? ' (present)' : ''}`,
        '',
        'Pass --force to wipe them and start a new mesh. This affects',
        'only THIS machine; other paired devices stay on the old mesh',
        'until they wipe their own state.',
        '',
      ].join('\n')
    );
    return 1;
  }

  if (args.force) {
    wipeLocalState();
  }

  // Fresh keyring for this device.
  const storage = keyringStorage();
  const deviceKeyring: MeshKeyring = {
    identity: generateSigningKeyPair(),
    knownPeers: new Map(),
    documentKeys: new Map([[DEFAULT_MESH_KEY_ID, generateDocumentKey()]]),
    revokedPeers: new Set<string>(),
  };
  await storage.save(deviceKeyring);

  // Fresh admin user key.
  const adminUserKey = generateSigningKeyPair();
  const adminIdentity = createUserIdentityFile(adminName, adminUserKey);

  const peerId = derivePeerId(deviceKeyring.identity.publicKey);
  const client = await openMeshClient({ peerId });
  try {
    // Wait on the SINGLETON `usersState.loaded` rather than a fresh
    // `$meshState` wrapper. createBootstrapUser / upsertUser write
    // through usersState — and polly's $meshState bridge has a
    // per-wrapper lazy-init that drops writes silently while
    // `currentHandle` is still null. Awaiting a different wrapper's
    // loaded promise didn't gate that init, so the writes hit a
    // not-yet-ready handle and never reached storage. The `users`
    // local was load-bearing for nothing.
    await Promise.all([usersState.loaded, devicesState.loaded, meshMetaState.loaded]);

    // Mesh name renders on the home view next to the fingerprint
    // so devices can eyeball-verify they're on the same mesh.
    // `--name` wins; otherwise a random Dylan-Thomas-flavoured line
    // feels less like a server and more like a place.
    const chosenName = args.name?.trim() || generateMeshName();
    setMeshName(chosenName);

    // Write the admin's self-signed UserEntry into mesh:users.
    createBootstrapUser({ displayName: adminName, userKey: adminUserKey });

    // `openMeshClient` runs touchSelfDeviceEntry as a side effect
    // but races the devicesState primitive's load completion; on a
    // fresh install the write can land on an unloaded doc and
    // `addEndorsementToDevice` below then can't find the row. Touch
    // again after the load settles so the endorsement write has
    // something to attach to.
    touchSelfDeviceEntry(peerId, { agent: 'cli', defaultName: hostname() });

    // Endorse this device with the admin user key so canDo() returns
    // admin permissions.
    addEndorsementToDevice(peerId, signEndorsement(adminIdentity, peerId));

    // Emit invites for each additional user. Each invite blob
    // carries the invitee's fresh private key signed by the admin
    // — admin-signed, safe for CRDT sync, ready to be consumed.
    const storedInvites: StoredInvite[] = [];
    for (const u of args.users) {
      const { blob, payload } = createInvite({
        displayName: u.name,
        roles: [u.role],
        adminUserKey,
        adminUserId: adminIdentity.userId,
      });
      // Pre-write the invitee's UserEntry so the row is present on
      // every peer. CRDT merge with the invitee's own post-pair
      // write lands last-write-wins on identical content.
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
      const stored: StoredInvite = {
        name: u.name,
        userId: payload.userId,
        role: u.role,
        createdAt: payload.createdAt,
        blob,
      };
      addInvite(stored);
      storedInvites.push(stored);
    }
    await flushOutgoing(2000);
    // Belt-and-braces: an extra long settle plus an explicit
    // repo.flush BEFORE the closeMesh() call. Polly's
    // `signal.value = ...` triggers an effect that queues a
    // handle.change op; we want every queued op to have hit the
    // NodeFS storage adapter and been written to disk before we
    // return. The closeMesh() in finally already calls repo.flush
    // again — this is the redundant safety net for the case where
    // a fresh handle is in 'ready' transition right when we
    // started writing.
    await new Promise((r) => setTimeout(r, 1000));
    await client.repo.flush();
    await new Promise((r) => setTimeout(r, 500));

    // Tell the user what just happened. Plain text, not JSON — the
    // admin reads this once.
    const recovery = exportRecoveryBlob(adminIdentity);
    const documentKey = deviceKeyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
    const fingerprint = documentKey ? await meshFingerprint(documentKey) : '(no key?)';
    process.stdout.write(
      [
        `New mesh created. This device is paired and "${adminName}" is its admin.`,
        `  name:        ${chosenName}`,
        `  fingerprint: ${fingerprint}`,
        '',
        '',
        'Admin recovery blob (save this somewhere safe — losing every device',
        'that holds this user key means losing the admin):',
        '',
        `  ${recovery}`,
        '',
        storedInvites.length === 0
          ? 'No additional users requested. Use `fairfox users invite` later.'
          : `${storedInvites.length} invite${storedInvites.length === 1 ? '' : 's'} ready:`,
        ...storedInvites.map(
          (i) => `  ${i.name.padEnd(16, ' ')}  ${i.role.padEnd(8, ' ')}  ${i.userId.slice(0, 16)}`
        ),
        '',
        storedInvites.length === 0 ? '' : 'Open each QR with:',
        ...storedInvites.map((i) => `  fairfox mesh invite open ${i.name.toLowerCase()}`),
        '',
        "Admin's UserEntry landed in mesh:users. Invites are signed",
        'and ready; each invitee gets paired + identified in one scan.',
        '',
      ].join('\n')
    );
    return 0;
  } finally {
    await closeMesh(client);
  }
}

// --- invite list / open ------------------------------------------

export async function meshInviteList(): Promise<number> {
  const file = loadInvitesFile();
  if (file.invites.length === 0) {
    process.stdout.write('(no pending invites)\n');
    return 0;
  }
  // Cross-reference with mesh:devices to show consumed state.
  const identity = loadUserIdentityFile();
  if (!identity) {
    // Can still list locally; just mark all as unknown status.
    for (const i of file.invites) {
      process.stdout.write(`  ${i.name.padEnd(16, ' ')}  ${i.role}  ${i.userId.slice(0, 16)}  ?\n`);
    }
    return 0;
  }
  const peerId = await loadPeerId();
  const client = await openMeshClient({ peerId });
  try {
    await waitForPeer(client, 4000);
    const devices = $meshState<DevicesDoc>('mesh:devices', DEVICES_INITIAL);
    await devices.loaded;
    const endorsedUserIds = new Set<string>();
    for (const d of Object.values(devices.value.devices)) {
      for (const owner of d.ownerUserIds ?? []) {
        endorsedUserIds.add(owner);
      }
    }
    for (const i of file.invites) {
      const consumed = endorsedUserIds.has(i.userId);
      const status = consumed ? 'consumed' : 'pending';
      process.stdout.write(
        `  ${status.padEnd(9, ' ')}  ${i.name.padEnd(16, ' ')}  ${i.role.padEnd(8, ' ')}  ${i.userId.slice(0, 16)}\n`
      );
    }
    return 0;
  } finally {
    await closeMesh(client);
  }
}

async function loadPeerId(): Promise<string> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    throw new Error('no keyring — run `fairfox mesh init` first');
  }
  return derivePeerId(keyring.identity.publicKey);
}

interface InviteOpenArgs {
  name: string | undefined;
  reopen: boolean;
}

function parseInviteOpenArgs(rest: readonly string[]): InviteOpenArgs {
  const out: InviteOpenArgs = { name: undefined, reopen: false };
  for (const arg of rest) {
    if (arg === '--reopen') {
      out.reopen = true;
    } else if (!out.name) {
      out.name = arg;
    }
  }
  return out;
}

export async function meshInviteOpen(rest: readonly string[]): Promise<number> {
  const args = parseInviteOpenArgs(rest);
  if (!args.name) {
    process.stderr.write('fairfox mesh invite open: expected a name.\n');
    return 1;
  }
  const stored = findInvite(args.name);
  if (!stored) {
    process.stderr.write(`fairfox mesh invite open: no invite named "${args.name}".\n`);
    return 1;
  }

  const peerId = await loadPeerId();
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    throw new Error('no keyring');
  }
  const sessionId = randomBase64(16);

  const client = await openMeshClient({
    peerId,
    onCustomFrame: (frame) => {
      if (frame.type !== 'pair-return' || frame.sessionId !== sessionId) {
        return;
      }
      const returnToken = typeof frame.token === 'string' ? frame.token : null;
      if (!returnToken) {
        return;
      }
      const agentHint = typeof frame.agent === 'string' ? frame.agent : undefined;
      const nameHint = typeof frame.name === 'string' ? frame.name : undefined;
      const userIdHint = typeof frame.userId === 'string' ? frame.userId : undefined;
      // Mutate polly's keyring instance directly, not our local
      // `storage.load()` copy — they are different objects, and the
      // MeshNetworkAdapter sitting under this client reads through the
      // polly-side one for `tryUnwrap` signature verification. Writing
      // only to the local copy left the running adapter with a stale
      // map and made it silently drop the scanner's first sync ops.
      void acceptReturnToken(returnToken, client.keyring, storage, client, {
        ...(agentHint ? { agent: agentHint } : {}),
        ...(nameHint ? { name: nameHint } : {}),
        ...(userIdHint ? { userId: userIdHint } : {}),
      }).then(() => {
        // Send a pair-ack so the scanner knows the issuer applied the
        // token and wrote its mesh:devices row.
        client.signaling.sendCustom('pair-ack', { sessionId });
        process.stdout.write(`\n✓ "${stored.name}" paired. Close with ctrl-c, or stay open.\n`);
      });
    },
  });
  try {
    await waitForPeer(client, 4000);

    // Check if the invite has already been consumed, refuse unless --reopen.
    const devices = $meshState<DevicesDoc>('mesh:devices', DEVICES_INITIAL);
    await devices.loaded;
    const consumed = Object.values(devices.value.devices).some((d) =>
      (d.ownerUserIds ?? []).includes(stored.userId)
    );
    if (consumed && !args.reopen) {
      process.stderr.write(
        `fairfox mesh invite open: "${stored.name}" is already paired on a device. Pass --reopen to issue another QR for this user (allows adding more devices under the same identity).\n`
      );
      return 1;
    }

    // Fresh pair-token for THIS open. Session id was already
    // generated above so the onCustomFrame callback has it in
    // closure.
    const documentKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
    const pairToken = encodePairingToken(
      createPairingToken({
        identity: keyring.identity,
        issuerPeerId: peerId,
        documentKey,
        documentKeyId: DEFAULT_MESH_KEY_ID,
      })
    );

    // Register with the signalling relay. Best-effort: the scanner's
    // one-scan flow needs our socket to be listening for pair-return
    // frames. If sendCustom returns false, fall through — the
    // manual-paste fallback still lets the invitee join.
    const registered = client.signaling.sendCustom('pair-issue', { sessionId });
    if (!registered) {
      process.stderr.write(
        'fairfox mesh invite open: signalling relay unavailable; scanner will have to paste back manually.\n'
      );
    }

    const base = process.env.FAIRFOX_URL ?? 'https://fairfox.fly.dev';
    const fragment = `pair=${encodeURIComponent(pairToken)}&s=${encodeURIComponent(sessionId)}&invite=${encodeURIComponent(stored.blob)}`;
    const shareUrl = `${base.replace(/\/$/, '')}/#${fragment}`;

    const qr = await QRCode.toString(shareUrl, { type: 'terminal', small: true });
    process.stdout.write(`\n${qr}\n`);
    process.stdout.write(`${shareUrl}\n\n`);
    process.stdout.write('Individual fields (if you want to inspect or paste by hand):\n\n');
    process.stdout.write(`  pair token:  ${pairToken}\n`);
    process.stdout.write(`  session id:  ${sessionId}\n`);
    process.stdout.write(`  invite blob: ${stored.blob}\n\n`);
    process.stdout.write('Paste-box fragment (everything after the `#` of the URL above):\n\n');
    process.stdout.write(`  ${fragment}\n\n`);
    process.stdout.write(
      `Invite open for "${stored.name}" (${stored.role}). Waiting for scan — ctrl-c to close.\n`
    );

    // Hold the process alive until the user hits ctrl-c.
    await new Promise<void>((resolve) => {
      const done = (): void => {
        process.stdout.write('\nInvite closed.\n');
        resolve();
      };
      process.on('SIGINT', done);
      process.on('SIGTERM', done);
    });
    return 0;
  } finally {
    await closeMesh(client);
  }
}

interface AcceptReturnHints {
  readonly agent?: string;
  readonly name?: string;
  readonly userId?: string;
}

async function acceptReturnToken(
  returnToken: string,
  keyring: MeshKeyring,
  storage: ReturnType<typeof keyringStorage>,
  client: MeshClient,
  hints: AcceptReturnHints = {}
): Promise<void> {
  const decoded = decodePairingToken(returnToken);
  applyPairingToken(decoded, keyring);
  await storage.save(keyring);
  // The WebRTC adapter captured `knownPeerIds` from the keyring at
  // `createMeshClient` time; the post-construction keyring mutation
  // above doesn't reach it on its own. Propagate the new peer so an
  // SDP offer fires the moment the scanner reconnects (or now, if
  // it's already in the signalling roster).
  client.webrtcAdapter.addKnownPeer(decoded.issuerPeerId);
  // Mirror the browser's `writeScannerDeviceRow` — write the scanner's
  // mesh:devices row directly from this side using the data carried in
  // the pair-return frame, so the issuer's view of mesh:devices has
  // the new peer immediately and doesn't have to wait for a WebRTC
  // sync round-trip that may not complete before the issuer's tab
  // closes. Without this, the row sits only in the scanner's local
  // storage and admin-side flows that key off mesh:devices (e.g.
  // `users revoke` mapping userId → peerIds) silently miss the new
  // device.
  await devicesState.loaded;
  const agent: 'cli' | 'browser' | 'extension' =
    hints.agent === 'cli' || hints.agent === 'extension' ? hints.agent : 'browser';
  const patch: Parameters<typeof upsertDeviceEntry>[1] = {
    agent,
    publicKey: Array.from(decoded.issuerPublicKey),
  };
  if (hints.name) {
    patch.name = hints.name;
  }
  if (hints.userId) {
    // Unsigned ownerUserIds binding — enough for `users revoke` to
    // map the userId back to peerIds. A SIGNED endorsement matters
    // for the policy layer (`permissionsForEntry`), but it's
    // already written by the scanner to its own row and races the
    // issuer's write through the mesh:devices map-replace CRDT
    // path. Closing that race needs per-key writes, separate work.
    patch.ownerUserIds = [hints.userId];
  }
  upsertDeviceEntry(decoded.issuerPeerId, patch);
}

export async function meshWhoami(): Promise<number> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write('fairfox mesh whoami: no keyring — run `fairfox mesh init` first.\n');
    return 1;
  }
  const documentKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
  const fingerprint = documentKey ? await meshFingerprint(documentKey) : '(missing document key)';
  const peerId = derivePeerId(keyring.identity.publicKey);

  // Read-only: local mesh:meta is the authoritative "what this
  // CLI thinks the mesh is called". No signalling fight with a
  // running daemon.
  const mesh = openMeshClientReadOnly();
  try {
    await awaitLoadedBudget(meshMetaState.loaded, 3000);
    const name = meshMetaState.value.name || '(unset)';
    process.stdout.write(
      [
        `name:        ${name}`,
        `fingerprint: ${fingerprint}`,
        `peerId:      ${peerId}`,
        `knownPeers:  ${keyring.knownPeers.size}`,
        '',
      ].join('\n')
    );
    return 0;
  } finally {
    await mesh.close();
  }
}

/** `fairfox add user <name> [--role X] [--queue-only]` —
 * Idempotent queue-and-open. Looks up an existing invite by name; if
 * none exists, mints a fresh one with the given role (defaults to
 * member), writes the UserEntry into mesh:users so the row is
 * everywhere, and stashes the blob in invites.json. Then opens the
 * live QR via meshInviteOpen unless --queue-only is set. Re-running
 * with the same name reopens the existing invite without minting a
 * new blob — the QR's pair-token + session id rotate per open, but
 * the underlying invite blob is stable. */
export async function meshAddUser(rest: readonly string[]): Promise<number> {
  let name = '';
  let role: Role = 'member';
  let queueOnly = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--role') {
      const v = rest[i + 1];
      i += 1;
      if (!v || !isValidRole(v)) {
        process.stderr.write('fairfox add user: --role must be admin, member, guest, or llm.\n');
        return 1;
      }
      role = v;
    } else if (arg === '--queue-only') {
      queueOnly = true;
    } else if (!arg.startsWith('-') && !name) {
      name = arg;
    }
  }
  if (!name) {
    process.stderr.write(
      'fairfox add user: usage: fairfox add user <name> [--role admin|member|guest|llm] [--queue-only]\n'
    );
    return 1;
  }

  // Already queued? Reopen rather than mint a duplicate.
  const existing = findInvite(name);
  if (existing) {
    process.stdout.write(`existing invite for "${name}" found (${existing.role}); reopening.\n`);
  } else {
    const adminIdentity = loadUserIdentityFile();
    if (!adminIdentity) {
      process.stderr.write(
        'fairfox add user: no local user identity — `fairfox init` or `fairfox pair <recovery-blob>` first.\n'
      );
      return 1;
    }
    const peerId = await loadPeerId();
    const client = await openMeshClient({ peerId });
    try {
      await waitForPeer(client, 8000);
      await usersState.loaded;
      const adminEntry = usersState.value.users[adminIdentity.userId];
      if (!adminEntry || !adminEntry.roles.includes('admin')) {
        process.stderr.write('fairfox add user: this user is not an admin in mesh:users.\n');
        return 1;
      }
      const { blob, payload } = createInvite({
        displayName: name,
        roles: [role],
        adminUserKey: adminIdentity.keypair,
        adminUserId: adminIdentity.userId,
      });
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
      addInvite({
        name,
        userId: payload.userId,
        role,
        createdAt: payload.createdAt,
        blob,
      });
      await flushOutgoing(2000);
    } finally {
      try {
        await closeMesh(client);
      } catch {
        // intentional
      }
    }
    process.stdout.write(`queued invite for "${name}" as ${role}.\n`);
  }

  if (queueOnly) {
    return 0;
  }
  return meshInviteOpen([name]);
}

export async function meshAddDevice(): Promise<number> {
  const peerId = await loadPeerId();
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write(
      [
        'fairfox mesh add-device: no keyring on this machine. Either:',
        '',
        '  fairfox mesh init --admin <name>   (start a new mesh)',
        '  curl -fsSL https://…/cli/install?token=<token>  (join an existing one)',
        '',
      ].join('\n')
    );
    return 1;
  }
  const identity = loadUserIdentityFile();
  const sessionId = randomBase64(16);

  const client = await openMeshClient({
    peerId,
    onCustomFrame: (frame) => {
      if (frame.type !== 'pair-return' || frame.sessionId !== sessionId) {
        return;
      }
      const returnToken = typeof frame.token === 'string' ? frame.token : null;
      if (!returnToken) {
        return;
      }
      const agentHint = typeof frame.agent === 'string' ? frame.agent : undefined;
      const nameHint = typeof frame.name === 'string' ? frame.name : undefined;
      const userIdHint = typeof frame.userId === 'string' ? frame.userId : undefined;
      // See comment in meshInviteOpen — pass the polly-side keyring
      // (the same instance the MeshNetworkAdapter reads on every
      // `tryUnwrap`), not our local `storage.load()` snapshot.
      void acceptReturnToken(returnToken, client.keyring, storage, client, {
        ...(agentHint ? { agent: agentHint } : {}),
        ...(nameHint ? { name: nameHint } : {}),
        ...(userIdHint ? { userId: userIdHint } : {}),
      }).then(() => {
        const label = identity?.displayName ?? 'a new device';
        process.stdout.write(`\n✓ Paired ${label}. Close with ctrl-c, or stay open.\n`);
      });
    },
  });
  try {
    await waitForPeer(client, 4000);

    const documentKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
    const pairToken = encodePairingToken(
      createPairingToken({
        identity: keyring.identity,
        issuerPeerId: peerId,
        documentKey,
        documentKeyId: DEFAULT_MESH_KEY_ID,
      })
    );

    const registered = client.signaling.sendCustom('pair-issue', { sessionId });
    if (!registered) {
      process.stderr.write(
        'fairfox mesh add-device: signalling relay unavailable; scanner will have to paste back manually.\n'
      );
    }

    // Embed the local user's recovery blob in the share URL when
    // we have one — that gives the scanner a one-tap "pair +
    // adopt my identity" experience. Without a local user
    // identity we still emit a valid pair URL; the scanner lands
    // on the Who-Are-You wizard afterwards to import their own
    // identity or create a new one.
    const recovery = identity ? exportRecoveryBlob(identity) : null;
    const base = process.env.FAIRFOX_URL ?? 'https://fairfox.fly.dev';
    const fragmentParts = [
      `pair=${encodeURIComponent(pairToken)}`,
      `s=${encodeURIComponent(sessionId)}`,
    ];
    if (recovery) {
      fragmentParts.push(`recovery=${encodeURIComponent(recovery)}`);
    }
    const fragment = fragmentParts.join('&');
    const shareUrl = `${base.replace(/\/$/, '')}/#${fragment}`;

    const qr = await QRCode.toString(shareUrl, { type: 'terminal', small: true });
    process.stdout.write(`\n${qr}\n`);
    process.stdout.write(`${shareUrl}\n\n`);
    process.stdout.write('Individual fields (if you want to inspect or paste by hand):\n\n');
    process.stdout.write(`  pair token:    ${pairToken}\n`);
    process.stdout.write(`  session id:    ${sessionId}\n`);
    if (recovery) {
      process.stdout.write(`  recovery blob: ${recovery}\n`);
    } else {
      process.stdout.write('  recovery blob: (none — this CLI has no local user identity)\n');
    }
    process.stdout.write('\nPaste-box fragment (everything after the `#` of the URL above):\n\n');
    process.stdout.write(`  ${fragment}\n\n`);
    if (identity) {
      process.stdout.write(
        `Add-device open for "${identity.displayName}". Waiting for scan — ctrl-c to close.\n\n`
      );
      process.stdout.write(
        'Treat the URL and recovery blob above like a password — they carry\n' +
          'your user secret key. Anyone who uses them becomes another device of yours.\n'
      );
    } else {
      process.stdout.write(
        'Add-device open (device-pair only — no user identity on this CLI).\n' +
          'The scanner will land on the "Who are you?" screen after pairing and\n' +
          'can import their own recovery blob or create a new user. Ctrl-c to close.\n'
      );
    }

    await new Promise<void>((resolve) => {
      const done = (): void => {
        process.stdout.write('\nAdd-device closed.\n');
        resolve();
      };
      process.on('SIGINT', done);
      process.on('SIGTERM', done);
    });
    return 0;
  } finally {
    await closeMesh(client);
  }
}

function randomBase64(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let binary = '';
  for (const b of buf) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `fairfox mesh serve` — open the mesh client and keep it open
 * until ctrl-c. Turns the CLI into a long-lived peer for the
 * duration of a shell session, useful as the "backbone" that
 * guarantees a second device (the laptop coming online for five
 * minutes, a phone PWA launched briefly) finds at least one
 * peer with the full mesh state to sync against. No UI, no
 * mutation — just an open door.
 *
 * Prints a status line every 15s with the current peer count
 * and the loaded doc counts for todo:*, library:main,
 * struggle:story so the user sees that the process is doing
 * something. The mesh client is closed cleanly on ctrl-c; any
 * pending outgoing Automerge messages flush on close. */
export async function meshServe(): Promise<number> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write(
      'fairfox mesh serve: no keyring — run `fairfox mesh init` or pair first.\n'
    );
    return 1;
  }
  // Phase 1 of the daemon rollout supersedes this verb for anyone
  // who wants their mesh peer to survive terminal exit. Only nag when
  // invoked from a user shell — the daemon itself never calls this.
  if (process.env.FAIRFOX_DAEMON_MANAGED !== '1') {
    process.stderr.write(
      'note: `fairfox mesh serve` is superseded by `fairfox daemon install && fairfox daemon start`.\n'
    );
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });

  const heartbeat = setInterval(() => {
    const peers = client.repo.peers.length;
    const now = new Date().toISOString().slice(11, 19);
    process.stdout.write(`[${now}] peers=${peers}\n`);
  }, 15_000);

  process.stdout.write(
    `fairfox mesh serve — peerId ${peerId}. Holding the mesh open. Ctrl-c to close.\n`
  );

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  clearInterval(heartbeat);
  process.stdout.write('\nmesh serve: closing.\n');
  try {
    await flushOutgoing(2000);
  } catch {
    // best-effort
  }
  await closeMesh(client);
  return 0;
}

/** `fairfox fingerprint` — print only the 8-hex mesh fingerprint.
 * Same value the hub renders in its Help-tab Diagnostics panel. Used
 * for the cross-device "are we on the same mesh?" check; output is
 * a single line so it's grep-friendly in scripts. */
export async function meshFingerprintCmd(): Promise<number> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write('fairfox fingerprint: no keyring — `fairfox init` first.\n');
    return 1;
  }
  const documentKey = keyring.documentKeys.get(DEFAULT_MESH_KEY_ID);
  if (!documentKey) {
    process.stderr.write('fairfox fingerprint: keyring has no mesh document key.\n');
    return 1;
  }
  process.stdout.write(`${await meshFingerprint(documentKey)}\n`);
  return 0;
}

// --- legacy dispatch (kept for older imports; bin.ts no longer calls)

const HEARTBEAT_COMPACTION_KEYS = ['daemon:leader', 'chat:health'] as const;
const ALL_COMPACTION_KEYS = ['mesh:devices', 'daemon:leader', 'chat:health'] as const;

function parseCompactArgs(rest: readonly string[]): readonly string[] | null {
  if (rest.length === 0) {
    return null;
  }
  const flag = rest[0];
  if (flag === '--all') {
    return ALL_COMPACTION_KEYS;
  }
  if (flag === '--heartbeats') {
    return HEARTBEAT_COMPACTION_KEYS;
  }
  return rest;
}

/** `fairfox mesh compact <key>` — ADR 0008.
 *
 * Re-seeds the named `$meshState` document under a fresh
 * `DocumentId` and writes the `mesh:document-index` entry that
 * points future `$meshState(key)` resolutions at the cleaned doc.
 * The polly-side redirect detector picks up the sealed sentinel on
 * the old doc and rebinds in-process wrappers transparently, so a
 * running daemon doesn't need a restart to start writing through
 * the new doc.
 *
 * Two compaction shapes are wired:
 *
 *   - **Entries-map filter** (`mesh:devices`): drop dead rows
 *     (`revokedAt` set) and keep the rest. Real byte-level reclaim
 *     for tombstone-heavy registries.
 *   - **Verbatim snapshot** (`daemon:leader`, `chat:health`):
 *     seed the new doc with the current materialised state as-is.
 *     Collapses the Automerge change history of heartbeat-style
 *     docs that get a write every few seconds; the per-tick history
 *     entries have no recovery value once the current state is
 *     captured. This is the path that rescues a mobile peer from
 *     OOMing on first sync when these docs have accumulated
 *     thousands of incremental chunks.
 *
 * Multi-key forms:
 *   `--heartbeats`  daemon:leader, chat:health
 *   `--all`         every supported key
 *
 * Requires `mesh.compact` (admin role).
 */
export async function meshCompact(rest: readonly string[]): Promise<number> {
  const keys = parseCompactArgs(rest);
  if (!keys || keys.length === 0) {
    process.stderr.write(
      'fairfox mesh compact: usage: fairfox mesh compact <key> | --heartbeats | --all\n' +
        `  supported keys: ${ALL_COMPACTION_KEYS.join(', ')}\n`
    );
    return 1;
  }
  const supported = new Set<string>(ALL_COMPACTION_KEYS);
  for (const key of keys) {
    if (!supported.has(key)) {
      process.stderr.write(
        `fairfox mesh compact: key "${key}" not supported. Currently supported: ${ALL_COMPACTION_KEYS.join(', ')}.\n`
      );
      return 1;
    }
  }

  // Compaction needs a networked mesh client: the index update
  // and the new doc both broadcast via the daemon-vs-CLI signalling
  // path. Yes this races a running daemon for the shared peerId
  // (CLI ergonomics memory): tens of seconds wall-clock, one-shot.
  const peerId = await loadPeerId();
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    if (!peered) {
      process.stderr.write(
        'fairfox mesh compact: no mesh peers reachable — the new doc and index will sync on next contact.\n'
      );
    }

    const { compactMeshDoc, snapshotMeshDoc } = await import('@fairfox/shared/compact-mesh-doc');
    const { documentIndexState } = await import('@fairfox/shared/document-index-state');
    const { userIdentity } = await import('@fairfox/shared/user-identity-state');
    const { devicesState } = await import('@fairfox/shared/devices-state');
    const { usersState } = await import('@fairfox/shared/users-state');
    const { canDo } = await import('@fairfox/shared/policy');
    const { CHAT_HEALTH_DOC_ID, CHAT_HEALTH_INITIAL, LEADER_LEASE_DOC_ID } = await import(
      '@fairfox/shared/assistant-state'
    );

    userIdentity.value = loadUserIdentityFile() ?? null;
    await Promise.all([devicesState.loaded, usersState.loaded, documentIndexState.loaded]);

    if (!canDo('mesh.compact')) {
      process.stderr.write(
        'fairfox mesh compact: requires `mesh.compact` permission (admin role).\n'
      );
      return 1;
    }

    for (const key of keys) {
      let result: {
        key: string;
        previousDocId: string;
        newDocId: string;
        removed: number;
        compactedAt: string;
      };
      if (key === 'mesh:devices') {
        result = await compactMeshDoc<DevicesDoc, DevicesDoc['devices'][string]>({
          key,
          repo: client.repo,
          wrapper: devicesState,
          selectEntries: (doc) => doc.devices,
          keep: (entry) => !entry.revokedAt,
          buildDoc: (entries) => ({ devices: entries }),
        });
      } else if (key === 'daemon:leader') {
        const leaseSignal = $meshState<LeaderLease>(LEADER_LEASE_DOC_ID, {
          deviceId: '',
          daemonId: '',
          expiresAt: '',
          renewedAt: '',
        });
        await leaseSignal.loaded;
        result = await snapshotMeshDoc<LeaderLease>({
          key,
          repo: client.repo,
          wrapper: leaseSignal,
        });
      } else {
        const healthSignal = $meshState<ChatHealth>(CHAT_HEALTH_DOC_ID, CHAT_HEALTH_INITIAL);
        await healthSignal.loaded;
        result = await snapshotMeshDoc<ChatHealth>({
          key,
          repo: client.repo,
          wrapper: healthSignal,
        });
      }
      const sealedLine = result.previousDocId
        ? `  sealed: ${result.previousDocId.slice(0, 16)}…\n`
        : '';
      process.stdout.write(
        `compacted ${result.key}\n` +
          (result.removed > 0 ? `  removed: ${result.removed} entries\n` : '') +
          `  newDocId: ${result.newDocId.slice(0, 16)}…\n` +
          sealedLine +
          `  at: ${result.compactedAt}\n`
      );
    }

    if (peered) {
      await flushOutgoing(2000);
    }

    process.stdout.write(
      '\nOther paired devices pick up the new docId via mesh:document-index sync\n' +
        'on next contact. A running daemon rebinds its wrappers via the in-process\n' +
        'redirect detector; no restart needed.\n'
    );
    return 0;
  } finally {
    await closeMesh(client);
  }
}

/** `fairfox mesh reconcile <key>` — ADR 0008 v3a.
 *
 * Reads the most-recent sealed doc for the key, applies the same
 * keep predicate the original compaction used, and writes any
 * entries the current doc is missing into the current doc.
 * Conservative — only adds entries that aren't already present.
 * Doesn't merge field-level edits to entries that exist in both
 * (that's v3b, deferred).
 *
 * Run periodically during the grace window after a compaction to
 * pull in writes that landed at the sealed doc (because an
 * offline device or stale-index device wrote there). Idempotent.
 */
export async function meshReconcile(rest: readonly string[]): Promise<number> {
  const key = rest[0];
  if (!key) {
    process.stderr.write('fairfox mesh reconcile: expected a key (e.g. mesh:devices).\n');
    return 1;
  }

  const peerId = await loadPeerId();
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    if (!peered) {
      process.stderr.write(
        'fairfox mesh reconcile: no mesh peers reachable — reconciliation runs against local state only.\n'
      );
    }

    const { reconcileMeshDoc } = await import('@fairfox/shared/compact-mesh-doc');
    const { documentIndexState } = await import('@fairfox/shared/document-index-state');
    const { userIdentity } = await import('@fairfox/shared/user-identity-state');
    const { devicesState } = await import('@fairfox/shared/devices-state');
    const { usersState } = await import('@fairfox/shared/users-state');
    const { canDo } = await import('@fairfox/shared/policy');

    userIdentity.value = loadUserIdentityFile() ?? null;
    await Promise.all([devicesState.loaded, usersState.loaded, documentIndexState.loaded]);

    if (!canDo('mesh.compact')) {
      process.stderr.write(
        'fairfox mesh reconcile: requires `mesh.compact` permission (admin role).\n'
      );
      return 1;
    }

    if (key !== 'mesh:devices') {
      process.stderr.write(
        `fairfox mesh reconcile: key "${key}" not supported yet. Currently supported: mesh:devices.\n`
      );
      return 1;
    }
    const result = await reconcileMeshDoc<DevicesDoc, DevicesDoc['devices'][string]>({
      key,
      repo: client.repo,
      selectEntries: (doc) => doc.devices,
      keep: (entry) => !entry.revokedAt,
    });

    if (peered) {
      await flushOutgoing(2000);
    }

    process.stdout.write(
      `reconciled ${result.key}\n` +
        `  sealed: ${result.sealedDocId.slice(0, 16)}…\n` +
        `  current: ${result.currentDocId.slice(0, 16)}…\n` +
        `  copied: ${result.copied} entries (post-seal writes to the sealed doc)\n` +
        `  skipped: ${result.skipped} entries (already in current doc)\n` +
        `  filtered: ${result.filtered} entries (dropped by the keep predicate)\n`
    );
    return 0;
  } finally {
    await closeMesh(client);
  }
}

export function meshUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox mesh — named-mesh lifecycle',
      '',
      'Usage:',
      '  fairfox mesh init --admin <n> [--name <mesh-name>]',
      '                   [--user <name>:<role>]... [--force]',
      '                                     Create a new mesh. --force wipes',
      "                                     this machine's keyring + user",
      '                                     identity + pending invites.',
      "  fairfox mesh whoami                Print this mesh's name, fingerprint,",
      "                                     and this device's peer id.",
      '  fairfox mesh invite list           Show pending and consumed invites.',
      '  fairfox mesh invite open <name>    Live QR for an invite — held open',
      '                                     until ctrl-c. --reopen to re-emit',
      '                                     after the user has already paired',
      '                                     one device (lets them add another).',
      '  fairfox mesh add-device            Live QR that pairs a new device',
      "                                     under THIS CLI's user identity",
      '                                     (your phone, a second laptop,',
      '                                     etc.). URL carries your recovery',
      '                                     blob — share only with yourself.',
      '  fairfox mesh serve                 Hold the mesh client open until',
      '                                     ctrl-c. Run this on a long-lived',
      '                                     machine (mini-PC, server) so the',
      '                                     mesh always has at least one peer',
      '                                     other devices can sync against.',
      '  fairfox mesh compact <key>         Re-seed a $meshState doc and collapse',
      '                                     its Automerge history. mesh:devices',
      '                                     drops revoked rows; daemon:leader and',
      '                                     chat:health snapshot the current state.',
      '                                     --heartbeats: daemon:leader+chat:health',
      '                                     --all: every supported key',
      '                                     ADR 0008; admin only.',
      '  fairfox mesh reconcile <key>       Pull post-compaction writes from the',
      '                                     sealed doc into the current doc.',
      '                                     Run during the grace window if you',
      '                                     suspect offline peers wrote to the',
      '                                     old doc after compaction.',
      '',
      "Only this machine's state is affected. Other paired devices stay on",
      'the old mesh until they wipe their own state.',
      '',
    ].join('\n')
  );
}

export function mesh(rest: readonly string[]): Promise<number> {
  const [verb, ...args] = rest;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    meshUsage(verb ? process.stdout : process.stderr);
    return Promise.resolve(verb ? 0 : 1);
  }
  if (verb === 'init') {
    return meshInit(args);
  }
  if (verb === 'invite') {
    const [subverb, ...subargs] = args;
    if (subverb === 'list') {
      return meshInviteList();
    }
    if (subverb === 'open') {
      return meshInviteOpen(subargs);
    }
  }
  if (verb === 'add-device') {
    return meshAddDevice();
  }
  if (verb === 'whoami') {
    return meshWhoami();
  }
  if (verb === 'serve') {
    return meshServe();
  }
  if (verb === 'compact') {
    return meshCompact(args);
  }
  if (verb === 'reconcile') {
    return meshReconcile(args);
  }
  meshUsage();
  return Promise.resolve(1);
}
