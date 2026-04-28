// Local storage for pending invites emitted by `fairfox mesh init`
// and `fairfox mesh invite …`. The admin's CLI mints each invite
// (admin-signed user key + role + displayName) and stashes it here
// so later invocations can list what's pending, reopen a stale QR,
// or cross-reference against mesh:devices to see which invites have
// been consumed.
//
// The blob itself carries the invitee's private key, so this file
// is as sensitive as the user-identity file — same chmod 0600.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { isRecord } from '@fairfox/shared/polly';
import type { Role } from '@fairfox/shared/users-state';
import { fairfoxPath } from '#src/paths.ts';

export const INVITES_PATH = fairfoxPath('invites.json');

export interface StoredInvite {
  /** Short display name the admin chose — primary lookup key for
   * `fairfox mesh invite open <name>`. Case-insensitive match. */
  name: string;
  /** The invitee's userId (hex pubkey). */
  userId: string;
  role: Role;
  createdAt: string;
  /** The admin-signed blob (base64-wrapped) that the invitee's
   * device consumes. Stable across reopens. */
  blob: string;
}

export interface InvitesFile {
  invites: StoredInvite[];
}

const EMPTY: InvitesFile = { invites: [] };

function writeAtomic(path: string, payload: InvitesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // chmod is best-effort.
  }
  renameSync(tmp, path);
}

function isStoredInviteShape(value: unknown): value is StoredInvite {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.name === 'string' &&
    typeof value.userId === 'string' &&
    typeof value.role === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.blob === 'string'
  );
}

export function loadInvitesFile(): InvitesFile {
  if (!existsSync(INVITES_PATH)) {
    return { invites: [] };
  }
  const raw = readFileSync(INVITES_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.invites)) {
    return EMPTY;
  }
  const invites = parsed.invites.filter(isStoredInviteShape);
  return { invites };
}

export function saveInvitesFile(file: InvitesFile): void {
  writeAtomic(INVITES_PATH, file);
}

export function addInvite(entry: StoredInvite): void {
  const file = loadInvitesFile();
  // Replace any prior invite with the same name — re-running `mesh
  // init` on the same user name refreshes rather than duplicates.
  const filtered = file.invites.filter((i) => i.name.toLowerCase() !== entry.name.toLowerCase());
  saveInvitesFile({ invites: [...filtered, entry] });
}

export function findInvite(name: string): StoredInvite | undefined {
  const needle = name.toLowerCase();
  return loadInvitesFile().invites.find((i) => i.name.toLowerCase() === needle);
}

export function clearInvitesFile(): void {
  if (!existsSync(INVITES_PATH)) {
    return;
  }
  unlinkSync(INVITES_PATH);
}
