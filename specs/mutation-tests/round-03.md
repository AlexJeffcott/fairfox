# Mutation testing round 3 — routing, lifecycle, and authority checks

| # | Mutation | Caught by | Time-to-detect |
|---|----------|-----------|----------------|
| B11 | `deserialiseMessage` swaps senderId / targetId | `e2e-mesh-roundtrip` (chat send hangs) | ~60 s timeout |
| B12 | `onPeerJoined` callback never fires | `e2e-mesh-roundtrip` | ~60 s timeout |
| B13 | revocation-authority check skipped | **NOT CAUGHT** | — |
| B14 | `fieldEquals` always returns true (`applyTopLevel` skips every write) | `e2e-mesh-roundtrip` | ~60 s timeout |
| B15 | `cloneDoc` returns the doc by reference | `e2e-mesh-roundtrip` (relay picks up but never replies) | ~60 s timeout |

4/5 caught. The miss is again a revocation-policy gap.

## Per-mutation detail

### B11 — `deserialiseMessage` swaps senderId / targetId

Mutation: `mesh.js:1149` swaps the two fields after parsing the header. Caught at e2e — the relay never replies because the assistant message it tries to send back has its routing scrambled. Tests that don't roundtrip through a remote peer wouldn't catch this; e2e-mesh-roundtrip does because it requires both directions of message flow.

### B12 — `onPeerJoined` never fires

Mutation: `mesh.js:1301` returns a no-op handler. Caught at e2e — same generic timeout. WebRTC handshake never starts because the adapter doesn't know peers exist.

### B13 — revocation-authority check skipped (NOT CAUGHT)

Mutation: `mesh.js:2544` short-circuits the `revocationAuthority` membership check so any keyring entry can issue revocations. Our user-revocation e2e only exercises an admin (who is in the authority set) issuing a revocation. We never exercise a non-admin attempting it.

**Outright miss.** Third revocation gap in this campaign:
- B3 — receive gate skipped (revoked peer's writes accepted)
- B10 — wrong target revoked (revokes issuer instead)
- B13 — authority check skipped (anyone can revoke anyone)

All three would slip past our suite. The pattern is consistent: we check revocation's *visible* output (the row in mesh:users) but none of its *security* properties.

### B14 — `applyTopLevel` skips every write (via `fieldEquals` lying)

Mutation: `mesh.js:1746` `fieldEquals` always returns true, so the inner `if (fieldEquals(...)) continue` short-circuits every write. Caught at e2e as another no-replication timeout.

Notable contrast with B5 (cloneDoc returns `{}`): B5 throws TypeError immediately because reads see no schema; B14 silently carries the initial empty value forward because writes are no-ops. Same root impact, very different fail signature, both end at the same e2e symptom. Without timing-resolution at the test layer, we can't tell them apart.

### B15 — `cloneDoc` returns by reference

Mutation: `mesh.js:1732` returns the doc instead of cloning it. Caught at e2e with a different signature than B11/B12/B14: the relay does pick up the pending, but its reply never lands. Likely the synchronous read leaks a mutated reference back into the Automerge handle's internal state, breaking subsequent change events.

This is the most "interesting" caught mutation in this round — it shows that not all "no-progress" failures look identical. e2e CAN distinguish "no peer-joined" (peers never connect) from "no relay reply" (handshake worked, processing failed) if we read the trace carefully.

## Headline takeaways

1. **Revocation is now a confirmed three-strike gap.** Three independent mutations to the revocation security boundary (B3, B10, B13) all sail past our suite. The user-revocation e2e tests rendering, not enforcement. This is the single most consequential systematic blind spot we've found.

2. **e2e timeouts are rich data we throw away.** B11, B12, B14 produce identical-looking "relay never processes" timeouts. B15 produces a "relay picks up but never replies" timeout — different intermediate state, but our test runner doesn't distinguish them. A test that captures *which milestone the relay last reached* before timing out would localise these mutations to specific subsystems even when the failure is generic.

3. **Subtle data corruption (B8, B14) is a coverage problem, not a tooling problem.** Tests that target specific docs catch their own corruption. The cure is breadth, not cleverness — every fairfox mesh doc needs at least one e2e that materially exercises it. Right now `chat:main`, `mesh:users`, `mesh:devices`, `agenda:main`, `todo:tasks`, `daemon:leader`, `chat:health` each have at least one test, but `todo:projects`, `agenda:main` (completions field), and the speakwell / library / docs / the-struggle / family-phone-admin docs are sparsely covered.
