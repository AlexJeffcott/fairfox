// The leader-lease semantics live in packages/cli/src/commands/chat.ts
// inline (tryAcquireLease), but the policy rule that lives in
// @fairfox/shared is the shape of the lease doc itself: a new lease
// must replace an expired one, and an expired lease cannot protect
// its holder from preemption.
//
// Test here is a lightweight state-machine exercise: given a starting
// LeaderLease + a "now" timestamp, decide whether a candidate ought
// to win. Mirrors the chat.ts implementation so we can unit-test
// the policy without spinning a mesh.

import { describe, expect, test } from 'bun:test';
import type { LeaderLease } from '#src/assistant-state.ts';

const TTL_MS = 30_000;

function canClaim(prev: LeaderLease, ownDaemonId: string, nowMs: number): boolean {
  const expiresMs = prev.expiresAt ? new Date(prev.expiresAt).getTime() : 0;
  const held: boolean = prev.daemonId.length > 0 && expiresMs > nowMs;
  const heldBySelf: boolean = held && prev.daemonId === ownDaemonId;
  return !held || heldBySelf;
}

function emptyLease(): LeaderLease {
  return {
    deviceId: '',
    daemonId: '',
    expiresAt: new Date(0).toISOString(),
    renewedAt: new Date(0).toISOString(),
  };
}

function leaseHeldBy(daemonId: string, deviceId: string, expiresMs: number): LeaderLease {
  return {
    deviceId,
    daemonId,
    expiresAt: new Date(expiresMs).toISOString(),
    renewedAt: new Date(expiresMs - TTL_MS).toISOString(),
  };
}

describe('leader lease', () => {
  test('empty lease is always claimable', () => {
    expect(canClaim(emptyLease(), 'me', Date.now())).toBe(true);
  });

  test('fresh lease held by another daemon blocks claim', () => {
    const now = Date.now();
    const lease = leaseHeldBy('other', 'other-device', now + 15_000);
    expect(canClaim(lease, 'me', now)).toBe(false);
  });

  test('fresh lease held by self is claimable (renewal)', () => {
    const now = Date.now();
    const lease = leaseHeldBy('me', 'me-device', now + 15_000);
    expect(canClaim(lease, 'me', now)).toBe(true);
  });

  test('expired lease is claimable by anyone', () => {
    const now = Date.now();
    const lease = leaseHeldBy('other', 'other-device', now - 5_000);
    expect(canClaim(lease, 'me', now)).toBe(true);
  });

  test('expiry boundary is strict — at exact expiry, lease is gone', () => {
    const now = Date.now();
    const lease = leaseHeldBy('other', 'other-device', now);
    expect(canClaim(lease, 'me', now)).toBe(true);
  });
});
