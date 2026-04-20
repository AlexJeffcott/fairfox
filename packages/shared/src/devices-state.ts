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

// Internal type for the CrdtPrimitive returned by $meshState. We only
// use the surface actually consumed (`value` read/write, `loaded`), so
// a structural type is enough; duplicating polly's full CrdtPrimitive
// here would couple this module to polly internals.
interface DevicesPrimitive {
  value: DevicesDoc;
  readonly loaded: Promise<void>;
}

export type DeviceAgent = 'browser' | 'cli' | 'extension';

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
  };
  devicesState.value = {
    ...devicesState.value,
    devices: { ...devicesState.value.devices, [peerId]: next },
  };
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
  options: { agent?: DeviceAgent; defaultName?: string } = {}
): void {
  const existing = devicesState.value.devices[peerId];
  const agent = options.agent ?? existing?.agent ?? 'browser';
  const fallbackName =
    options.defaultName ??
    existing?.name ??
    (agent === 'cli' ? 'CLI' : agent === 'extension' ? 'Extension' : defaultBrowserName());
  upsertDeviceEntry(peerId, { agent, name: fallbackName });
}
