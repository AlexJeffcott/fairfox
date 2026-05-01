# Mutation testing round 4 — lifecycle, signing, framing, and the persistence trap

| # | Mutation | Caught by | Time-to-detect |
|---|----------|-----------|----------------|
| B16 | `peer-disconnected` event never propagated | `e2e-mesh-roundtrip` (phone never sees reply) | ~60 s timeout |
| B17 | `sign` always signs a constant zero payload | **5 unit tests** | <1 s |
| B18 | `decodeSignedEnvelope` signature offset shifted by 1 byte | `e2e-mesh-roundtrip` (no replication) | ~60 s timeout |
| B19 | `currentHandle` never published — bridge effect silently drops every write | `e2e-mesh-roundtrip` | ~60 s timeout |
| B20 | `$crdtState` write-bridge calls `handle.change` but the callback is empty | `e2e-mesh-roundtrip` | ~60 s timeout |

5/5 caught.

## Per-mutation detail

### B16 — `peer-disconnected` event never propagated

Mutation: `mesh.js:1031` swap propagation handler for `() => {}`. Caught at e2e — chat send roundtrip fails because the relay's view of "who's still here" goes stale. The phone never sees its assistant reply.

### B17 — `sign` returns a constant signature

Mutation: `mesh.js:965` body signs `new Uint8Array(32)` regardless of payload. **Caught immediately by 5 unit tests** that round-trip `sign(payload, key)` → `verify(payload, signature, publicKey)`. Same shape as B1 — direct unit tier coverage of negative cryptographic invariants.

### B18 — `decodeSignedEnvelope` byte-offset off by one

Mutation: `mesh.js:1012` reads signature from `[4 + senderLen + 1, ...]` instead of `[4 + senderLen, ...]`. Caught at e2e (no replication). Unit tests pass because they don't exercise the wire codec round-trip directly.

**Gap**: a unit test that does `encodeSignedEnvelope(env)` followed by `decodeSignedEnvelope(bytes)` and asserts every field matches would have caught this in <1 s. We have signing-layer round-trip tests but not wire-codec round-trip tests.

### B19 — `currentHandle` never published

Mutation: `mesh.js:1676` comments out the `currentHandle = handle` assignment. The bridge effect at line 1705 then short-circuits on `if (!currentHandle) return;` and every `inner.value = ...` write goes nowhere. Caught at e2e.

This is exactly the polly persistence bug we found earlier this session by inspection (during the chat:main / mesh:users / users-state work). The fix landed via singleton accessors for the wrappers. The good news: B19 confirms our recent e2e additions WOULD now catch it as a regression.

### B20 — `handle.change` callback empty

Mutation: `mesh.js:1709` replaces the body of `(doc) => applyTopLevel(doc, value)` with a no-op. Caught at e2e — same generic timeout. Different mechanism from B19 (the bridge fires; the change is just empty), same observable failure.

## Headline takeaways

1. **B19 + B20 prove the persistence bug class is now defended.** Both the "currentHandle never set" (write goes nowhere because the bridge bails) and the "change callback empty" (bridge fires, mutation is empty) variants are caught by mesh-roundtrip. Our recent fix wasn't only a one-shot patch; it grew the test surface enough to detect future regressions of the same shape.

2. **The 60-second e2e timeout is doing too much work.** Almost every "no replication" mutation reads as the same 60 s wait followed by the same generic error. A faster signal — e.g. a relay heartbeat that emits "I have N peers and last received sync op T seconds ago" plus a test assertion that those numbers move within 5 s of a write — would turn 60 s timeouts into 5 s sharp failures and would make different mutations distinguishable from the failure message alone.

3. **Wire-codec round-trips deserve unit tests.** B18 (off-by-one in signature offset parsing) is exactly the kind of bug that breaks framing without breaking type-checking, lint, or higher-level protocol tests. A few `encode` → `decode` → assert-fields-equal unit tests would catch a whole family of these.
