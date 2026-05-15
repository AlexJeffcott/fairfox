// Locks in the convergence property ADR 0009 commits fairfox to.
//
// The bug captured in fairfox#22 was that the daemon's
// peersGcRevoked wrote the new devices map via the value-setter
// path, which lowers to one Automerge op replacing the top-level
// devices field. The iPhone had a concurrent per-key edit on the
// same field (its self-row lastSeenAt bump) — and Automerge
// resolves that collision by actor-id hash, discarding one side.
// The damage was stable: 2 entries on the daemon, 89 on the
// iPhone, no future sync round could reconcile them.
//
// These tests are an Automerge-layer spec for the migration that
// follows. They do NOT boot polly, signalling, or WebRTC — the
// property is purely about how Automerge merges per-key writes
// vs top-level replacements. A real two-device e2e covers the
// transport; this test covers the merge semantics the transport
// relies on.
//
// One of the three cases is intentionally the bug — it captures
// the divergence we're moving away from. If `peerA wins`
// becomes `peerB wins` in some future Automerge release the
// case still passes; the assertion is "one of the two is lost",
// which is the failure mode we don't want code to depend on.

import { describe, expect, test } from 'bun:test';
import * as Automerge from '@automerge/automerge';

interface DevicesDoc {
  [key: string]: unknown;
  devices: Record<string, { name: string }>;
}

interface ItemsDoc {
  [key: string]: unknown;
  items: string[];
}

describe('per-key writes converge; top-level replace does not', () => {
  test('two devices, same map, different keys — per-key writes merge cleanly', () => {
    const seed = Automerge.from<DevicesDoc>({ devices: {} });
    const a = Automerge.clone(seed);
    const b = Automerge.clone(seed);
    const a2 = Automerge.change(a, (d) => {
      d.devices.peerA = { name: 'A' };
    });
    const b2 = Automerge.change(b, (d) => {
      d.devices.peerB = { name: 'B' };
    });
    const merged = Automerge.merge(a2, b2);
    expect(Object.keys(merged.devices).sort()).toEqual(['peerA', 'peerB']);
    expect(merged.devices.peerA?.name).toBe('A');
    expect(merged.devices.peerB?.name).toBe('B');
  });

  test('two devices, same map, top-level replace — one side silently lost', () => {
    // The negative spec: this is the bug fairfox#22 captured in
    // production. Both devices wrote the WHOLE map; Automerge
    // resolved by actor-id hash; only one entry survives.
    const seed = Automerge.from<DevicesDoc>({ devices: {} });
    const a = Automerge.clone(seed);
    const b = Automerge.clone(seed);
    const a2 = Automerge.change(a, (d) => {
      d.devices = { peerA: { name: 'A' } };
    });
    const b2 = Automerge.change(b, (d) => {
      d.devices = { peerB: { name: 'B' } };
    });
    const merged = Automerge.merge(a2, b2);
    expect(Object.keys(merged.devices).length).toBe(1);
  });

  test('two devices, same array, different pushes — per-element merges both', () => {
    const seed = Automerge.from<ItemsDoc>({ items: [] });
    const a = Automerge.clone(seed);
    const b = Automerge.clone(seed);
    const a2 = Automerge.change(a, (d) => {
      d.items.push('A');
    });
    const b2 = Automerge.change(b, (d) => {
      d.items.push('B');
    });
    const merged = Automerge.merge(a2, b2);
    expect([...merged.items].sort()).toEqual(['A', 'B']);
  });
});
