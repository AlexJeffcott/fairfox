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

// Internal type for the CrdtPrimitive returned by $meshState. We only
// use the surface actually consumed (`value` read/write, `loaded`), so
// a structural type is enough; duplicating polly's full CrdtPrimitive
// here would couple this module to polly internals.
interface DevicesPrimitive {
  value: DevicesDoc;
  readonly loaded: Promise<void>;
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
 * future "recently paired" affordance. */
export function upsertDeviceEntry(
  peerId: string,
  patch: Partial<Omit<DeviceEntry, 'peerId' | 'createdAt'>> & {
    createdAt?: string;
    agent?: DeviceAgent;
  }
): void {
  const existing = devicesState.value.devices[peerId];
  const now = new Date().toISOString();
  const next: DeviceEntry = {
    peerId,
    name: patch.name ?? existing?.name ?? '',
    createdAt: existing?.createdAt ?? patch.createdAt ?? now,
    lastSeenAt: patch.lastSeenAt ?? now,
    agent: patch.agent ?? existing?.agent ?? 'browser',
    ownerUserIds: patch.ownerUserIds ?? existing?.ownerUserIds,
    endorsements: patch.endorsements ?? existing?.endorsements,
    capabilities: patch.capabilities ?? existing?.capabilities,
    revokedAt: patch.revokedAt ?? existing?.revokedAt,
    revocationSignature: patch.revocationSignature ?? existing?.revocationSignature,
    revokedByUserId: patch.revokedByUserId ?? existing?.revokedByUserId,
  };
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
  options: { agent?: DeviceAgent; defaultName?: string; capabilities?: Capability[] } = {}
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
  upsertDeviceEntry(peerId, { agent, name: fallbackName, capabilities });
}
