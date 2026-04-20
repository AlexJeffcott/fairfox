// `fairfox users …` — read the mesh:users document from the CLI.
// Mirrors the admin-only Users tab in the browser home sub-app;
// mutation (invite, revoke, whoami) is deferred until the CLI has
// its own user-identity storage (today the user keypair lives only
// in the browser's IndexedDB, so there's no CLI-side "current
// user"). This thin read-only path is still useful for confirming
// the admin's own bootstrap landed and for scripting a rollout
// status check.

import { $meshState } from '@fairfox/polly/mesh';
import type { UserEntry, UsersDoc } from '@fairfox/shared/users-state';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '#src/mesh.ts';

const USERS_INITIAL: UsersDoc = { users: {} };

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
  return `${shortId}  ${roles.padEnd(16, ' ')}  ${entry.displayName}${revoked}`;
}

export function usersList(): Promise<number> {
  return (async () => {
    const peerId = await loadOwnPeerId();
    const client = await openMeshClient({ peerId });
    try {
      const peered = await waitForPeer(client, 8000);
      const users = $meshState<UsersDoc>('mesh:users', USERS_INITIAL);
      await users.loaded;
      if (peered) {
        await flushOutgoing(2000);
      }
      const entries = Object.values(users.value.users);
      if (entries.length === 0) {
        process.stdout.write('(no users yet — bootstrap one from a browser)\n');
        return 0;
      }
      // Stable sort: admins first, then alphabetical by name.
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
      await client.close();
    }
  })();
}

export function usersUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    [
      'fairfox users — mesh-wide user registry',
      '',
      'Usage:',
      '  fairfox users            List every user in the mesh (admins first).',
      '',
      'Invite / revoke / whoami are browser-only today — the CLI has no user',
      'identity store yet. Use the Users tab on the home sub-app for those.',
      '',
    ].join('\n')
  );
}

export function users(rest: readonly string[]): Promise<number> {
  const [verb] = rest;
  if (!verb) {
    return usersList();
  }
  if (verb === 'help' || verb === '--help' || verb === '-h') {
    usersUsage(process.stdout);
    return Promise.resolve(0);
  }
  usersUsage();
  return Promise.resolve(1);
}
