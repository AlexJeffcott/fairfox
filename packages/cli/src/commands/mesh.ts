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
import {
  $meshState,
  applyPairingToken,
  createPairingToken,
  DEFAULT_MESH_KEY_ID,
  decodePairingToken,
  encodePairingToken,
  generateDocumentKey,
  generateSigningKeyPair,
  type MeshKeyring,
} from '@fairfox/polly/mesh';
import type { DevicesDoc } from '@fairfox/shared/devices-state';
import { createInvite } from '@fairfox/shared/invite';
import type { Role } from '@fairfox/shared/users-state';
import QRCode from 'qrcode';
import {
  addInvite,
  clearInvitesFile,
  findInvite,
  loadInvitesFile,
  type StoredInvite,
} from '#src/invites-node.ts';
import {
  derivePeerId,
  KEYRING_PATH,
  keyringStorage,
  openMeshClient,
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
  users: InitUser[];
  force: boolean;
}

function isValidRole(s: string): s is Role {
  return s === 'admin' || s === 'member' || s === 'guest' || s === 'llm';
}

function parseInitArgs(rest: readonly string[]): InitArgs {
  const args: InitArgs = { admin: undefined, users: [], force: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--force') {
      args.force = true;
    } else if (arg === '--admin') {
      args.admin = rest[i + 1];
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

async function meshInit(rest: readonly string[]): Promise<number> {
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
    // Don't write to mesh:users / mesh:devices from the CLI during
    // init. polly's $meshState signal layer hits "Cycle detected"
    // in the preact signals core on bun when a write triggers
    // automerge's change event synchronously while the signal's
    // own effect is still on the stack. The browser's event loop
    // spaces these out; bun runs tighter. We defer every CRDT
    // write to the next device that opens a browser under this
    // identity:
    //
    //   - admin UserEntry + self-endorsement → written by the
    //     browser's hydrate path the first time Alex opens his
    //     laptop / phone under this user identity (post-import).
    //   - invitee UserEntry rows → written by each invitee's
    //     browser when they consume the invite URL.
    //
    // Invite blobs are already admin-signed at invite generation
    // time so no ambient mesh state is required to mint them; the
    // signature verifies against the admin's userId-embedded
    // pubkey.
    const storedInvites: StoredInvite[] = [];
    for (const u of args.users) {
      const { blob, payload } = createInvite({
        displayName: u.name,
        roles: [u.role],
        adminUserKey,
        adminUserId: adminIdentity.userId,
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

    // Tell the user what just happened. Plain text, not JSON — the
    // admin reads this once.
    const recovery = exportRecoveryBlob(adminIdentity);
    process.stdout.write(
      [
        `New mesh created. This device is paired and "${adminName}" is its admin.`,
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
        "Admin's entry (admin role) lands in mesh:users the first time",
        'a browser opens under this identity (WhoAreYouView → import',
        'recovery blob). Invites are already signed and ready.',
        '',
      ].join('\n')
    );
    return 0;
  } finally {
    await client.close();
  }
}

// --- invite list / open ------------------------------------------

async function meshInviteList(): Promise<number> {
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
    await client.close();
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

async function meshInviteOpen(rest: readonly string[]): Promise<number> {
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
      void acceptReturnToken(returnToken, keyring, storage).then(() => {
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

    const base = process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
    const fragment = `pair=${encodeURIComponent(pairToken)}&s=${encodeURIComponent(sessionId)}&invite=${encodeURIComponent(stored.blob)}`;
    const shareUrl = `${base.replace(/\/$/, '')}/#${fragment}`;

    const qr = await QRCode.toString(shareUrl, { type: 'terminal', small: true });
    process.stdout.write(`\n${qr}\n`);
    process.stdout.write(`${shareUrl}\n\n`);
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
    await client.close();
  }
}

async function acceptReturnToken(
  returnToken: string,
  keyring: MeshKeyring,
  storage: ReturnType<typeof keyringStorage>
): Promise<void> {
  applyPairingToken(decodePairingToken(returnToken), keyring);
  await storage.save(keyring);
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

// --- dispatch ----------------------------------------------------

export function meshUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox mesh — named-mesh lifecycle',
      '',
      'Usage:',
      '  fairfox mesh init --admin <name> [--user <name>:<role>]... [--force]',
      '                                     Create a new mesh. --force wipes',
      "                                     this machine's keyring + user",
      '                                     identity + pending invites.',
      '  fairfox mesh invite list           Show pending and consumed invites.',
      '  fairfox mesh invite open <name>    Live QR for an invite — held open',
      '                                     until ctrl-c. --reopen to re-emit',
      '                                     after the user has already paired',
      '                                     one device (lets them add another).',
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
  meshUsage();
  return Promise.resolve(1);
}
