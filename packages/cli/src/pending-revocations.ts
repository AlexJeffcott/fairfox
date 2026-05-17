// Pending transport-level revocations — polly#112 / fairfox#26.
//
// `users revoke` writes the `[revoked]` row into mesh:users AND
// closes polly's transport-level receive gate against the revoked
// peer's devicePeerIds (so post-revocation writes never land). The
// catch: closing the gate the instant the row is written means the
// revoked peer can never receive the row in the first place —
// polly's `MeshNetworkAdapter.tryUnwrap` drops every inbound sync
// message from the revoked peer, so the docSynchronizer for
// mesh:users never advances past the opening handshake on the
// admin's side, no ops are returned in response to the peer's
// request, and the row never replicates. That's the polly#112
// fingerprint diagnosed against `scripts/e2e-user-revocation.ts`.
//
// The fix is defer-and-resume:
//
//   - `users revoke` writes the row and, if a peer is present,
//     waits a brief window for the doc to converge on the target
//     peer using polly's per-(docId, peerId) `peerDocumentStatus`
//     diagnostic. If convergence is observed, the transport gate
//     closes immediately. If the wait times out (peer offline, or
//     present but didn't ack), the revocation is queued in this
//     marker file.
//
//   - `chat serve` reads the marker on startup and re-checks it on
//     every heartbeat. The instant the snapshot confirms the
//     revoked peer has converged on mesh:users (with the heads
//     stamped after the revocation), the gate closes and the
//     marker entry is cleared.
//
// The marker file is the bridge across process lifetimes — the
// `users revoke` invocation is a short-lived CLI and cannot itself
// wait indefinitely for a peer to come online.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fairfoxPath } from '#src/paths.ts';

const PENDING_REVOCATIONS_FILE = 'pending-transport-revocations.json';

export interface PendingRevocation {
  /** Device peerId polly should drop inbound messages from once
   * the marker fires. The same shape `revokePeerLocally` consumes. */
  devicePeerId: string;
  /** UserId named in the mesh:users `[revoked]` row. Used for
   * operator-facing logging when the deferred revocation fires. */
  revokedUserId: string;
  /** ISO timestamp the revocation was issued. The resume path uses
   * this as the floor for `lastSyncMessageInAt` comparisons so a
   * pre-revocation `"has"` doesn't satisfy the post-revocation
   * convergence check. */
  issuedAt: string;
}

export interface PendingRevocationsFile {
  /** Format version for future migrations. */
  version: 1;
  /** Keyed by `devicePeerId` so a repeat revocation against the
   * same device idempotently overwrites the prior entry. */
  entries: Record<string, PendingRevocation>;
}

function isPendingRevocationsFile(value: unknown): value is PendingRevocationsFile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record: Record<string, unknown> = value as unknown as Record<string, unknown>;
  return record.version === 1 && typeof record.entries === 'object' && record.entries !== null;
}

export function loadPendingRevocations(): PendingRevocationsFile {
  const path = fairfoxPath(PENDING_REVOCATIONS_FILE);
  if (!existsSync(path)) {
    return { version: 1, entries: {} };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isPendingRevocationsFile(parsed)) {
      return parsed;
    }
  } catch {
    // Corrupted marker — treat as empty. The fix path will rewrite
    // a clean file the next time anything is queued.
  }
  return { version: 1, entries: {} };
}

export function savePendingRevocations(file: PendingRevocationsFile): void {
  writeFileSync(fairfoxPath(PENDING_REVOCATIONS_FILE), JSON.stringify(file, null, 2));
}

export function queuePendingRevocation(entry: PendingRevocation): void {
  const file = loadPendingRevocations();
  file.entries[entry.devicePeerId] = entry;
  savePendingRevocations(file);
}

export function clearPendingRevocation(devicePeerId: string): void {
  const file = loadPendingRevocations();
  if (!(devicePeerId in file.entries)) {
    return;
  }
  delete file.entries[devicePeerId];
  savePendingRevocations(file);
}
