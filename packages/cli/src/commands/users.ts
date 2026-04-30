// `fairfox users …` — full parity with the browser's Users tab, now
// that the CLI carries its own user-identity file at
// ~/.fairfox/user-identity.json (alongside the keyring). Five
// subcommands:
//
//   list              every user, admins first
//   whoami            display local identity
//   bootstrap <name>  first-admin creation on a fresh mesh
//   import <blob>     load an existing user's recovery blob
//   export            print the local recovery blob
//   invite <name>     emit an invite blob for a new user
//   revoke <userId>   write a signed revocation
//
// Invite / revoke require a local identity with the appropriate
// role. List + whoami work without one.

import { createInvite } from '@fairfox/shared/invite';
import { permissionsForEntry } from '@fairfox/shared/policy';
import { generateSigningKeyPair } from '@fairfox/shared/polly';
import {
  createBootstrapUser,
  type Role,
  revokeUser,
  type UserEntry,
  usersState,
} from '@fairfox/shared/users-state';
import {
  closeMesh,
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '#src/mesh.ts';
import {
  createUserIdentityFile,
  exportRecoveryBlob,
  importRecoveryFile,
  loadUserIdentityFile,
  USER_IDENTITY_PATH,
} from '#src/user-identity-node.ts';

async function loadOwnPeerId(): Promise<string> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    throw new Error('no keyring — run `fairfox pair <token>` first');
  }
  return derivePeerId(keyring.identity.publicKey);
}

function formatEntry(entry: UserEntry): string {
  const roles = entry.roles.length > 0 ? entry.roles.join(',') : '(no roles)';
  const shortId = entry.userId.slice(0, 16);
  const revoked = entry.revokedAt ? ' [revoked]' : '';
  const grants =
    entry.grants.length === 0
      ? ''
      : `  +grants[${entry.grants.map((g) => g.permission).join(',')}]`;
  return `${shortId}  ${roles.padEnd(16, ' ')}  ${entry.displayName}${revoked}${grants}`;
}

// --- readers -----------------------------------------------------

export function usersList(): Promise<number> {
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      const peered = await waitForPeer(client, 8000);
      const users = usersState;
      await users.loaded;
      if (peered) {
        await flushOutgoing(2000);
      }
      const entries = Object.values(users.value.users);
      if (entries.length === 0) {
        process.stdout.write('(no users yet — bootstrap one with `fairfox users bootstrap`)\n');
        return 0;
      }
      entries.sort((a, b) => {
        const aAdmin = a.roles.includes('admin');
        const bAdmin = b.roles.includes('admin');
        if (aAdmin !== bAdmin) {
          return aAdmin ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
      for (const entry of entries) {
        process.stdout.write(`${formatEntry(entry)}\n`);
      }
      return 0;
    } finally {
      await closeMesh(client);
    }
  })();
}

export function usersWhoami(): Promise<number> {
  const identity = loadUserIdentityFile();
  if (!identity) {
    process.stdout.write(
      '(no local user identity — use `fairfox users bootstrap` or `fairfox users import`)\n'
    );
    return Promise.resolve(0);
  }
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      await waitForPeer(client, 4000);
      const users = usersState;
      await users.loaded;
      const entry = users.value.users[identity.userId];
      process.stdout.write(`userId:     ${identity.userId}\n`);
      process.stdout.write(`name:       ${identity.displayName}\n`);
      if (entry) {
        const perms = Array.from(permissionsForEntry(entry)).sort().join(', ') || '(none)';
        process.stdout.write(`roles:      ${entry.roles.join(', ') || '(none)'}\n`);
        process.stdout.write(
          `grants:     ${entry.grants.map((g) => g.permission).join(', ') || '(none)'}\n`
        );
        process.stdout.write(`effective:  ${perms}\n`);
        if (entry.revokedAt) {
          process.stdout.write(`revokedAt:  ${entry.revokedAt}\n`);
        }
      } else {
        process.stdout.write(
          'status:     local identity, but no matching UserEntry in this mesh. Accept an invite or bootstrap.\n'
        );
      }
      return 0;
    } finally {
      await closeMesh(client);
    }
  })();
}

// --- bootstrap / import / export ---------------------------------

export function usersBootstrap(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) {
    process.stderr.write('fairfox users bootstrap: expected a display name.\n');
    return Promise.resolve(1);
  }
  if (loadUserIdentityFile()) {
    process.stderr.write(
      `fairfox users bootstrap: a user identity already exists at ${USER_IDENTITY_PATH}. Use \`fairfox users export\` to see the recovery blob, or --force a re-bootstrap.\n`
    );
    return Promise.resolve(1);
  }
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      const peered = await waitForPeer(client, 8000);
      const users = usersState;
      await users.loaded;
      const existingCount = Object.keys(users.value.users).length;
      if (existingCount > 0) {
        process.stderr.write(
          'fairfox users bootstrap: this mesh already has a user registry. Use `fairfox users import <blob>` with a recovery blob, or accept a fresh invite.\n'
        );
        return 1;
      }
      const keypair = generateSigningKeyPair();
      const identity = createUserIdentityFile(trimmed, keypair);
      createBootstrapUser({ displayName: trimmed, userKey: keypair });
      if (peered) {
        await flushOutgoing(2000);
      }
      const blob = exportRecoveryBlob(identity);
      process.stdout.write(`created admin user "${trimmed}" (${identity.userId})\n`);
      process.stdout.write('\nRecovery blob — save this somewhere safe:\n');
      process.stdout.write(`\n${blob}\n\n`);
      return 0;
    } finally {
      await closeMesh(client);
    }
  })();
}

export function usersImport(blob: string): Promise<number> {
  try {
    const identity = importRecoveryFile(blob);
    process.stdout.write(`imported "${identity.displayName}" (${identity.userId})\n`);
    return Promise.resolve(0);
  } catch (err) {
    process.stderr.write(
      `fairfox users import: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return Promise.resolve(1);
  }
}

export function usersExport(): Promise<number> {
  const identity = loadUserIdentityFile();
  if (!identity) {
    process.stderr.write('fairfox users export: no local user identity.\n');
    return Promise.resolve(1);
  }
  process.stdout.write(`${exportRecoveryBlob(identity)}\n`);
  return Promise.resolve(0);
}

// --- invite / revoke ---------------------------------------------

interface InviteArgs {
  role: Role;
  name: string;
}

function parseInviteArgs(rest: readonly string[]): InviteArgs | null {
  let role: Role = 'member';
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--role' && rest[i + 1]) {
      const next = rest[i + 1];
      if (next === 'admin' || next === 'member' || next === 'guest' || next === 'llm') {
        role = next;
        i += 1;
      } else {
        return null;
      }
    } else if (typeof arg === 'string') {
      positional.push(arg);
    }
  }
  const name = positional.join(' ').trim();
  if (!name) {
    return null;
  }
  return { role, name };
}

export function usersInvite(rest: readonly string[]): Promise<number> {
  const parsed = parseInviteArgs(rest);
  if (!parsed) {
    process.stderr.write(
      'fairfox users invite: usage: fairfox users invite <name> [--role admin|member|guest|llm]\n'
    );
    return Promise.resolve(1);
  }
  const identity = loadUserIdentityFile();
  if (!identity) {
    process.stderr.write(
      'fairfox users invite: no local user identity — bootstrap or import one first.\n'
    );
    return Promise.resolve(1);
  }
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      const peered = await waitForPeer(client, 8000);
      const users = usersState;
      await users.loaded;
      const adminEntry = users.value.users[identity.userId];
      if (!adminEntry) {
        process.stderr.write(
          'fairfox users invite: local user has no UserEntry in mesh:users. Bootstrap first.\n'
        );
        return 1;
      }
      const adminPerms = permissionsForEntry(adminEntry);
      if (!adminPerms.has('user.invite')) {
        process.stderr.write(
          `fairfox users invite: role "${adminEntry.roles.join(',')}" doesn't hold user.invite.\n`
        );
        return 1;
      }
      const { blob, payload } = createInvite({
        displayName: parsed.name,
        roles: [parsed.role],
        adminUserKey: identity.keypair,
        adminUserId: identity.userId,
      });
      // Also write the invitee's UserEntry so the row exists
      // regardless of whether the invitee's own upsertUser survives
      // their post-pair reload; CRDT merge handles duplicates.
      users.value = {
        ...users.value,
        users: {
          ...users.value.users,
          [payload.userId]: {
            userId: payload.userId,
            displayName: payload.displayName,
            roles: payload.roles,
            grants: payload.grants,
            createdByUserId: payload.createdByUserId,
            createdAt: payload.createdAt,
            signature: payload.signature,
          },
        },
      };
      if (peered) {
        await flushOutgoing(2000);
      }
      const base = process.env.FAIRFOX_URL ?? 'https://fairfox-production-8273.up.railway.app';
      const shareUrl = `${base.replace(/\/$/, '')}/#invite=${encodeURIComponent(blob)}`;
      process.stdout.write(`invited "${parsed.name}" as ${parsed.role} (${payload.userId})\n`);
      process.stdout.write(`\nSend them this link:\n\n${shareUrl}\n\n`);
      process.stdout.write(
        "(the link carries the invitee's private key — treat it like a password)\n"
      );
      return 0;
    } finally {
      await closeMesh(client);
    }
  })();
}

export function usersRevoke(targetUserId: string): Promise<number> {
  if (!targetUserId || targetUserId.length < 4) {
    process.stderr.write('fairfox users revoke: expected a userId.\n');
    return Promise.resolve(1);
  }
  const identity = loadUserIdentityFile();
  if (!identity) {
    process.stderr.write('fairfox users revoke: no local user identity.\n');
    return Promise.resolve(1);
  }
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      const peered = await waitForPeer(client, 8000);
      const users = usersState;
      await users.loaded;
      const revokerEntry = users.value.users[identity.userId];
      if (!revokerEntry) {
        process.stderr.write('fairfox users revoke: local user has no UserEntry in mesh:users.\n');
        return 1;
      }
      if (!permissionsForEntry(revokerEntry).has('user.revoke')) {
        process.stderr.write(
          `fairfox users revoke: role "${revokerEntry.roles.join(',')}" doesn't hold user.revoke.\n`
        );
        return 1;
      }
      if (!users.value.users[targetUserId]) {
        process.stderr.write(`fairfox users revoke: no user "${targetUserId}" in mesh:users.\n`);
        return 1;
      }
      revokeUser({
        userId: targetUserId,
        revokerUserId: identity.userId,
        revokerUserKey: identity.keypair,
      });
      if (peered) {
        await flushOutgoing(2000);
      }
      process.stdout.write(`revoked ${targetUserId}\n`);
      return 0;
    } finally {
      await closeMesh(client);
    }
  })();
}

// --- dispatch ----------------------------------------------------

export function usersUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox users — mesh-wide user registry',
      '',
      'Usage:',
      '  fairfox users                      List every user (admins first).',
      '  fairfox users whoami               Print the local identity.',
      '  fairfox users bootstrap <name>     Create the first admin on a fresh mesh.',
      '  fairfox users import <blob>        Load an existing user from a recovery blob.',
      '  fairfox users export               Print the local recovery blob.',
      '  fairfox users invite <name>        Invite a user.',
      '                        --role admin|member|guest|llm  (default: member)',
      '  fairfox users revoke <userId>      Write a signed revocation.',
      '',
      'Local identity is stored at ~/.fairfox/user-identity.json — chmod 0600.',
      '',
    ].join('\n')
  );
}

export function users(rest: readonly string[]): Promise<number> {
  const [verb, ...args] = rest;
  if (!verb) {
    return usersList();
  }
  if (verb === 'help' || verb === '--help' || verb === '-h') {
    usersUsage(process.stdout);
    return Promise.resolve(0);
  }
  if (verb === 'whoami') {
    return usersWhoami();
  }
  if (verb === 'bootstrap') {
    return usersBootstrap(args.join(' '));
  }
  if (verb === 'import' && args[0]) {
    return usersImport(args[0]);
  }
  if (verb === 'export') {
    return usersExport();
  }
  if (verb === 'invite') {
    return usersInvite(args);
  }
  if (verb === 'revoke' && args[0]) {
    return usersRevoke(args[0]);
  }
  usersUsage();
  return Promise.resolve(1);
}
