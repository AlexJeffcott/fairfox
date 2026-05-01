# Mutation testing round 2 — encryption, signalling, and selective corruption

| # | Mutation | Caught by | Time-to-detect |
|---|----------|-----------|----------------|
| B6 | `sealEnvelope` ships plaintext (encryption no-op) | `e2e-mesh-roundtrip` (relay never processes) | ~60 s timeout |
| B7 | `sendSignal` no-op | `e2e-mesh-roundtrip` (relay never processes) | ~60 s timeout |
| B8 | `applyTopLevel` skips `users` key | **only `e2e-user-revocation`**; mesh-roundtrip passes | depends which test runs |
| B9 | `knownPeers.get` forced undefined | `e2e-mesh-roundtrip` | ~60 s timeout |
| B10 | `applyRevocation` revokes the issuer instead of the target | **NOT CAUGHT** | — |

3/5 cleanly caught. One conditional miss (B8 — only caught when the test happens to write to the affected doc). One outright miss (B10 — same gap as B3).

## Per-mutation detail

### B6 — `sealEnvelope` returns plaintext

Mutation: `mesh.js:122` `sealEnvelope` body returns `{ documentId, sealed: payload }` instead of encrypting.

Caught at e2e level — relay never receives a parseable encrypted envelope, so nothing flows. Failure mode is "no replication", not "encryption disabled". An attacker who could push a polly version with this mutation could ship plaintext on the wire and be detected only by users complaining nothing replicates — privacy loss is invisible until the wire is inspected.

**Gap**: no test asserts that on-wire bytes (post `wrap`) are non-trivial encrypted form (e.g. byte structure not equal to plain serialised message). A unit test that wraps a known message and asserts `sealEnvelope(...).sealed !== originalPayload` would catch this in <1 s.

### B7 — `sendSignal` no-op

Mutation: `mesh.js:1326` body returns `false` immediately, never calls `socket.send`.

Caught at e2e — same "no replication" timeout as B6. WebRTC handshake can't form because the SDP exchange goes nowhere. Same diagnostic limitation: failure mode reads as "relay never processes", not "signalling-relay broken".

### B8 — `applyTopLevel` selectively skips the `users` key

Mutation: `mesh.js:1735` body adds `if (key === "users") continue;` — every other top-level field syncs, mesh:users does not.

`bun test`: 0 failures.
`e2e-mesh-roundtrip`: PASS (only writes to chat:main).
`e2e-user-revocation`: FAIL — `local user has no UserEntry in mesh:users`.

**Diagnostic gap**: subtle key-targeted corruption only fires when a test exercises the affected doc shape. A test that ONLY exercises chat:main is blind to silent users:* corruption. The e2e suite's coverage of which top-level keys per doc are written is incidental, not designed.

### B9 — `knownPeers.get` forced undefined

Mutation: replace `this.keyring.knownPeers.get(signed.senderId)` with `undefined` — every receive is silently dropped at the unknown-sender gate.

Caught at e2e — same timeout signature as B6/B7.

### B10 — `applyRevocation` revokes the issuer instead of the target (NOT CAUGHT)

Mutation: `mesh.js:2437` `applyRevocation` adds `record.issuerPeerId` to `revokedPeers` instead of `record.revokedPeerId`. So calling `users revoke <member>` from the admin… revokes the admin instead. The revoked member's peerId is never added to the local `revokedPeers` set, but the `mesh:users` doc still gets a `[revoked]` entry written for them.

`bun test`: 0 failures.
`e2e-user-revocation`: PASS.

**Outright miss.** This is a more aggressive variant of round-1's B3. Same root gap: our user-revocation e2e only asserts the visible artefact (the `[revoked]` row) and never tests whether `revokedPeers` actually contains the right peerId. With this mutation, an admin could "revoke" any member and instead lock themselves out of the mesh — and our test suite would let that ship.

## Headline takeaways

1. **"No replication" is the e2e tier's most common diagnostic and its blind spot.** Three of five round-2 mutations (B6, B7, B9) caused identical-looking timeouts. They're all caught, but the caller has no way to localise the cause. We need either:
   - (a) a layered set of low-level integration tests that wrap/unwrap a known message and assert structural properties of the wire bytes, OR
   - (b) richer logging from the relay's no-progress path so a test failure points at "no peers connected" vs "peers connected, decode failing" vs "peers connected, decode worked, sync stuck".

2. **Subtle key-targeted corruption is hit-or-miss.** B8 was caught only because user-revocation happens to exercise mesh:users. A spec saying "every fairfox-owned $meshState doc has at least one e2e that writes and reads through it" would close this — we'd track it as test-coverage metadata next to the doc's type definition.

3. **The revocation gap is now confirmed in two flavours.** Both B3 (skip the gate on receive) and B10 (apply revocation to the wrong peer) sail past our suite, because the test only checks the cosmetic effect of revocation, not its semantic effect. Same single fix would close both: the `e2e-revoke-then-write` follow-up from round 1.
