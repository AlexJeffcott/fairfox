// Devices state — the self-declared registry of every paired device.
//
// Each device writes its own entry at pair time and refreshes
// `lastSeenAt` on every subsequent mesh connection. Other devices read
// the document through `$meshState` and render the result in the Peers
// view on home and `fairfox peers` on the CLI. The mesh is already a
// trust boundary — any paired device can write to any `$meshState` doc
// — so letting every device name itself adds no new adversarial
// surface. The alternative (per-device local nicknames) would push the
// naming job onto every viewer and fragment across the mesh; a
// self-declared doc keeps the identity in one place with CRDT merge
// semantics.
//
// Schema lock: polly's `$meshState` is first-writer-wins for schema.
// The target shape is baked in on day one — no optional fields that a
// later version would have to backfill.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import { detectCapabilities } from '#src/capabilities.ts';

// Internal type for the CrdtPrimitive returned by $meshState. We use
// `value` (read/write), `loaded`, and `handle` — the last one is
// needed for per-key writes that don't go through polly's
// applyTopLevel (which clobbers the whole `devices` map on each
// `value =` assignment, racing concurrent issuer/scanner writes).
interface DocHandleLike {
  change(updater: (doc: DevicesDoc) => void): void;
}
interface DevicesPrimitive {
  value: DevicesDoc;
  readonly loaded: Promise<void>;
  readonly handle: DocHandleLike | undefined;
}

export type DeviceAgent = 'browser' | 'cli' | 'extension';

/** Capability strings a device self-declares. Used by the UI to hide
 * affordances that won't work on this device — NOT a security
 * boundary. A device that lies about its capabilities only confuses
 * the UI. Anything load-bearing for correctness must gate on a
 * user permission instead. */
export type Capability =
  | 'webrtc'
  | 'pwa-installed'
  | 'push-notifications'
  | 'camera'
  | 'keyboard'
  | 'background-sync'
  | 'llm-peer';

/** A signature by a user key binding a user to a device. Stored on
 * the device row so verifiers can check it without side-channels.
 * Signed payload: `{ deviceId, userId, addedAt }` as JSON. */
export interface Endorsement {
  userId: string;
  /** 64-byte Ed25519 signature as `number[]` — Automerge doesn't
   * round-trip Uint8Array reliably. */
  signature: number[];
  addedAt: string;
}

export interface DeviceEntry {
  peerId: string;
  name: string;
  /** ISO 8601 timestamp. Written once, on first announcement. */
  createdAt: string;
  /** ISO 8601 timestamp. Bumped on each mesh connection open. */
  lastSeenAt: string;
  /** Which kind of device wrote this entry. Drives the agent chip in
   * the peer-list row. */
  agent: DeviceAgent;
  /** The device's signing public key (32 bytes as number[]). Each
   * device writes its own row with its own pubkey on boot; every
   * other device harvests this field into its local keyring so
   * mutual trust propagates through the mesh without requiring N²
   * pairwise pairings. Optional for migration — pre-harvest rows
   * just don't contribute to trust propagation. */
  publicKey?: number[];
  /** User ids endorsed on this device. Effective permissions are the
   * intersection of these users' permission sets (Phase E). Optional
   * for migration: pre-Phase-A rows don't have this field — a read
   * site treats undefined the same as empty. */
  ownerUserIds?: string[];
  /** One entry per `ownerUserIds` element, in the same order.
   * Optional for migration. */
  endorsements?: Endorsement[];
  /** Device-local capabilities self-declared at boot. Optional for
   * migration (Phase D populates it). */
  capabilities?: Capability[];
  /** ISO 8601 timestamp set when this device is revoked by an admin.
   * A revoked device is filtered out of the effective-permission
   * calculation on every other peer. */
  revokedAt?: string;
  /** Signature over `{ peerId, revokedAt }` by the revoking user's
   * key. Phase F verifies the revoker holds `device.revoke`. */
  revocationSignature?: number[];
  /** The user that signed the revocation, if any. */
  revokedByUserId?: string;
}

export interface DevicesDoc {
  [key: string]: unknown;
  /** Keyed by peer id so a device's own entry is easy to look up
   * without scanning an array. */
  devices: Record<string, DeviceEntry>;
}

// Lazy initialisation: the CLI bundle imports this module at startup
// (through `bin.ts` → `commands/peers.ts`), but the Repo isn't
// configured until a subcommand actually calls `openMeshClient`.
// Evaluating `$meshState` at module load throws "no Repo configured".
// Deferring the call until first access of `.value` / `.loaded` makes
// the module safe to import eagerly and still Just Works in the
// browser, where `ensure-mesh` has already configured the Repo by the
// time anything reads the signal.
let _devicesPrimitive: DevicesPrimitive | null = null;

function primitive(): DevicesPrimitive {
  if (_devicesPrimitive === null) {
    _devicesPrimitive = $meshState<DevicesDoc>('mesh:devices', { devices: {} });
  }
  return _devicesPrimitive;
}

export const devicesState: DevicesPrimitive = {
  get value(): DevicesDoc {
    return primitive().value;
  },
  set value(next: DevicesDoc) {
    primitive().value = next;
  },
  get loaded(): Promise<void> {
    return primitive().loaded;
  },
  get handle(): DocHandleLike | undefined {
    const p = primitive();
    return (p as unknown as { handle?: DocHandleLike }).handle;
  },
};

/** Read-only helper for the common case of "does this peer have an
 * entry yet?" — used on the browser side to decide whether to prompt
 * for a name on first pairing. */
export function deviceEntryFor(peerId: string): DeviceEntry | undefined {
  return devicesState.value.devices[peerId];
}

/** Write-through helper: upsert or patch an entry. Callers supply
 * whichever fields they want to change; untouched fields keep their
 * previous value. Always preserves `createdAt` when the entry already
 * exists — the first announcement timestamp is load-bearing for any
 * future "recently paired" affordance.
 *
 * Writes go directly through `handle.change` against the per-peer
 * key (`doc.devices[peerId] = next`) rather than through the
 * `devicesState.value = …` path. The latter routes via polly's
 * `applyTopLevel`, which assigns the entire `devices` field at once
 * — concurrent writes from issuer (admin writing the new device
 * row in `acceptReturnToken`) and scanner (the new device's own
 * `addEndorsementToDevice` during pair completion) both replace
 * the whole map and Automerge picks one winner by hash-of-actor-id,
 * dropping the loser's row.
 *
 * Per-key writes let Automerge merge concurrent updates to
 * different peer rows cleanly. Same-peer concurrent updates still
 * resolve last-write-wins on the entry as a whole, which is fine
 * for the practical cases (rename, lastSeenAt bump): nobody loses
 * a foreign device row to a local rename. The `e2e-revoke-then-write`
 * test was the spec for this fix; it documents the gap as the
 * "second blocker" stacked behind the receive-side enforcement
 * (which is in polly already). */
export function upsertDeviceEntry(
  peerId: string,
  patch: Partial<Omit<DeviceEntry, 'peerId' | 'createdAt'>> & {
    createdAt?: string;
    agent?: DeviceAgent;
  }
): void {
  const existing = devicesState.value.devices[peerId];
  const now = new Date().toISOString();
  // Build the entry field-by-field and only include optional fields
  // when they actually have a value. Automerge rejects explicit
  // undefined on optional fields ("Cannot assign undefined value at
  // /devices/.../ownerUserIds") so writing `{ ownerUserIds: undefined }`
  // crashes the accept path on fresh rows.
  const next: DeviceEntry = {
    peerId,
    name: patch.name ?? existing?.name ?? '',
    createdAt: existing?.createdAt ?? patch.createdAt ?? now,
    lastSeenAt: patch.lastSeenAt ?? now,
    agent: patch.agent ?? existing?.agent ?? 'browser',
  };
  const publicKey = patch.publicKey ?? existing?.publicKey;
  if (publicKey !== undefined) {
    next.publicKey = publicKey;
  }
  const ownerUserIds = patch.ownerUserIds ?? existing?.ownerUserIds;
  if (ownerUserIds !== undefined) {
    next.ownerUserIds = ownerUserIds;
  }
  const endorsements = patch.endorsements ?? existing?.endorsements;
  if (endorsements !== undefined) {
    next.endorsements = endorsements;
  }
  const capabilities = patch.capabilities ?? existing?.capabilities;
  if (capabilities !== undefined) {
    next.capabilities = capabilities;
  }
  const revokedAt = patch.revokedAt ?? existing?.revokedAt;
  if (revokedAt !== undefined) {
    next.revokedAt = revokedAt;
  }
  const revocationSignature = patch.revocationSignature ?? existing?.revocationSignature;
  if (revocationSignature !== undefined) {
    next.revocationSignature = revocationSignature;
  }
  const revokedByUserId = patch.revokedByUserId ?? existing?.revokedByUserId;
  if (revokedByUserId !== undefined) {
    next.revokedByUserId = revokedByUserId;
  }

  const handle = devicesState.handle;
  if (handle) {
    handle.change((doc) => {
      if (!doc.devices) {
        doc.devices = {};
      }
      const current = doc.devices[peerId];
      if (!current) {
        // First write — initialise the whole entry.
        doc.devices[peerId] = next;
        return;
      }
      // Existing entry: write only the fields the caller actually
      // patched, leaving every other field at its Automerge-tracked
      // value. Same-peer concurrent updates that touch DIFFERENT
      // fields merge cleanly (e.g. issuer writes name + agent while
      // scanner writes endorsements + ownerUserIds during pair
      // completion); same-field concurrent updates resolve LWW per
      // field, which is fine for rename and lastSeenAt-bump cases.
      // Always bump lastSeenAt — every write is a "I saw it" signal.
      current.lastSeenAt = next.lastSeenAt;
      if (patch.name !== undefined) {
        current.name = next.name;
      }
      if (patch.agent !== undefined) {
        current.agent = next.agent;
      }
      if (patch.publicKey !== undefined) {
        current.publicKey = next.publicKey;
      }
      if (patch.ownerUserIds !== undefined) {
        current.ownerUserIds = next.ownerUserIds;
      }
      if (patch.endorsements !== undefined) {
        current.endorsements = next.endorsements;
      }
      if (patch.capabilities !== undefined) {
        current.capabilities = next.capabilities;
      }
      if (patch.revokedAt !== undefined) {
        current.revokedAt = next.revokedAt;
      }
      if (patch.revocationSignature !== undefined) {
        current.revocationSignature = next.revocationSignature;
      }
      if (patch.revokedByUserId !== undefined) {
        current.revokedByUserId = next.revokedByUserId;
      }
    });
    return;
  }
  // Pre-loaded fallback: the wrapper hasn't bridged its handle yet
  // (rare; happens at boot when the very first write arrives before
  // the loaded promise resolves). Fall through to the value-setter
  // so the write isn't lost — it'll get clobbered if a concurrent
  // peer write arrives in the same window, but that's strictly no
  // worse than the prior behaviour.
  devicesState.value = {
    ...devicesState.value,
    devices: { ...devicesState.value.devices, [peerId]: next },
  };
}

/** Merge a fresh endorsement into a device row. Called from the
 * "add me to a shared device" flow. If the userId already has an
 * endorsement its entry is replaced (a re-endorsement bumps the
 * timestamp). */
export function addEndorsementToDevice(peerId: string, endorsement: Endorsement): void {
  const existing = devicesState.value.devices[peerId];
  if (!existing) {
    throw new Error(`addEndorsementToDevice: unknown peer ${peerId}`);
  }
  const prevEndorsements = existing.endorsements ?? [];
  const prevOwners = existing.ownerUserIds ?? [];
  const endorsements = prevEndorsements.filter((e) => e.userId !== endorsement.userId);
  endorsements.push(endorsement);
  const ownerUserIds = prevOwners.includes(endorsement.userId)
    ? prevOwners
    : [...prevOwners, endorsement.userId];
  upsertDeviceEntry(peerId, { endorsements, ownerUserIds });
}

/** Remove an endorsement from a device row. Used by both the leaving
 * user ("remove me from this device") and by an admin force-revoking
 * a user's access to a device they don't own. Phase F's accept hook
 * enforces the rule that the remover must match the removed user or
 * hold `user.revoke`. */
export function removeEndorsementFromDevice(peerId: string, userId: string): void {
  const existing = devicesState.value.devices[peerId];
  if (!existing) {
    throw new Error(`removeEndorsementFromDevice: unknown peer ${peerId}`);
  }
  const prevEndorsements = existing.endorsements ?? [];
  const prevOwners = existing.ownerUserIds ?? [];
  const endorsements = prevEndorsements.filter((e) => e.userId !== userId);
  const ownerUserIds = prevOwners.filter((id) => id !== userId);
  upsertDeviceEntry(peerId, { endorsements, ownerUserIds });
}

function defaultBrowserName(): string {
  if (typeof navigator === 'undefined') {
    return 'Browser';
  }
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) {
    return 'iPhone';
  }
  if (/iPad/i.test(ua)) {
    return 'iPad';
  }
  if (/Android/i.test(ua)) {
    return 'Android';
  }
  if (/Mac OS X/i.test(ua)) {
    return 'Mac';
  }
  if (/Windows/i.test(ua)) {
    return 'Windows';
  }
  if (/Linux/i.test(ua)) {
    return 'Linux';
  }
  return 'Browser';
}

/** Ensure the current device has an entry in `mesh:devices` and bump
 * `lastSeenAt`. Called from the browser on every mesh-client open and
 * from the pairing ceremony after each successful half so a freshly
 * paired device is discoverable before the post-pairing reload.
 *
 * A device that already has an entry keeps its name; only `lastSeenAt`
 * moves. A fresh device gets a sensible default derived from the user
 * agent family — the peer list lets the user rename it later. */
export function touchSelfDeviceEntry(
  peerId: string,
  options: {
    agent?: DeviceAgent;
    defaultName?: string;
    capabilities?: Capability[];
    publicKey?: Uint8Array;
  } = {}
): void {
  const existing = devicesState.value.devices[peerId];
  const agent = options.agent ?? existing?.agent ?? 'browser';
  const fallbackName =
    options.defaultName ??
    existing?.name ??
    (agent === 'cli' ? 'CLI' : agent === 'extension' ? 'Extension' : defaultBrowserName());
  // Refresh the capability list on every touch — it's cheap and
  // picks up the pwa-installed flip the first time the tab loads
  // after the user installs the PWA, or the push-notifications flip
  // after a permission change. Callers can override (e.g. the CLI
  // passes its own list since `detectCapabilities` is browser-only).
  const capabilities = options.capabilities ?? detectCapabilities();
  // Publish this device's signing pubkey in its own row so other
  // peers can harvest it into their local knownPeers set without
  // needing a direct pairwise pair ceremony — see `harvestPeerKeys`
  // below. Only set when the caller supplies the key; the row stays
  // backward-compatible with rows written by pre-harvest clients.
  const publicKey = options.publicKey ? Array.from(options.publicKey) : existing?.publicKey;
  upsertDeviceEntry(peerId, { agent, name: fallbackName, capabilities, publicKey });
}

/** Walk every row in `mesh:devices`, pull the `publicKey` out, and
 * compare to the supplied keyring's `knownPeers`. Returns the list
 * of newly-added peers so the caller can decide whether to reload
 * (browser) or log (CLI). Trust closure: we add every peer we can
 * see in the doc — the fact that the doc synced to us is evidence
 * that the introducer was trusted upstream.
 *
 * Revoked rows (`revokedAt` set) are skipped: the whole point of
 * revocation is that the peer's key should not be re-added to any
 * peer's keyring, even if the row is still present in the doc.
 *
 * Callers must `saveKeyring` afterwards; this helper mutates
 * keyring.knownPeers in place but leaves persistence to the
 * caller. */
export function harvestPeerKeys(keyring: {
  knownPeers: Map<string, Uint8Array>;
  identity: { publicKey: Uint8Array };
}): string[] {
  const selfPeerId = Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const added: string[] = [];
  for (const entry of Object.values(devicesState.value.devices)) {
    if (entry.peerId === selfPeerId) {
      continue;
    }
    if (entry.revokedAt) {
      continue;
    }
    if (keyring.knownPeers.has(entry.peerId)) {
      continue;
    }
    if (!entry.publicKey || entry.publicKey.length !== 32) {
      continue;
    }
    keyring.knownPeers.set(entry.peerId, new Uint8Array(entry.publicKey));
    added.push(entry.peerId);
  }
  return added;
}

/** Tombstone a device row in `mesh:devices` so every peer on the
 * mesh sees it as revoked. Unlike `forgetPeer` (keyring-local
 * only), this write syncs via CRDT to everyone, prevents future
 * trust-harvests from re-adding the peer's pubkey, and collapses
 * the device's effective permissions to empty. The caller supplies
 * the revocation record — already signed over
 * `{ peerId, revokedAt, revokedByUserId }` with a user key that
 * held `device.revoke` at the time — so that a Phase-F accept hook
 * on every other peer can verify the signature against the stored
 * timestamp. */
export function revokeDeviceEntry(
  peerId: string,
  revocation: { userId: string; signature: Uint8Array; revokedAt: string }
): void {
  const existing = devicesState.value.devices[peerId];
  if (!existing) {
    throw new Error(`revokeDeviceEntry: unknown peer ${peerId}`);
  }
  if (existing.revokedAt) {
    return;
  }
  upsertDeviceEntry(peerId, {
    revokedAt: revocation.revokedAt,
    revokedByUserId: revocation.userId,
    revocationSignature: Array.from(revocation.signature),
  });
}
