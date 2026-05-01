# Mutation testing round 1 — security and replication primitives

Five deliberate breakages of `node_modules/@fairfox/polly/dist/src/mesh.js`, run against our test suite to see which slip through. Pristine `mesh.js` saved at `/tmp/polly-mesh-pristine.js` (md5 `211245b84f153bb280bc751fad6f77b2`); reverted between mutations. Workflow per mutation: edit `mesh.js`, rebuild CLI bundle, run targeted test(s), record outcome, restore pristine.

## Summary

| # | Mutation | Caught by | Time-to-detect |
|---|----------|-----------|----------------|
| B1 | Ed25519 `verify` always returns true | **4 unit tests** (`bun test`) | <1 s |
| B2 | `MeshNetworkAdapter.send` is a no-op | `e2e-agenda-concurrent` | ~30 s |
| B3 | revocation gate on receive disabled | **NOT CAUGHT** | — |
| B4 | `$meshState.value =` setter swallows writes | `e2e-mesh-roundtrip` (mesh init crashes) | <5 s |
| B5 | `cloneDoc` returns an empty object | `e2e-mesh-roundtrip` (TypeError on first read) | <5 s |

4/5 caught. The miss is the one that matters most.

## Per-mutation detail

### B1 — Ed25519 `verify` returns true unconditionally

Mutation: `mesh.js:978` `return nacl2.sign.detached.verify(...)` → `return true`.

Caught by `bun test` — 4 unit tests fail loudly:
- `verifiedEndorsementUserIds > returns only valid endorsers under strict mode`
- `invite > verifyInviteSignature rejects tampered role escalation`
- `invite > verifyInviteSignature rejects a signature from a different admin`
- `users-state > verifyUserSignature rejects a row with tampered displayName`

These directly assert the negative case (a tampered signature is rejected). No gap.

### B2 — `MeshNetworkAdapter.send` no-op

Mutation: `mesh.js:1055-1058` `this.base.send(wrapped)` → `return`.

Unit tests pass (they don't construct a real adapter). Caught at e2e by `e2e-agenda-concurrent`: alice sees `{alice:true, bob:false}`, bob sees `{alice:false, bob:true}`. Each peer's writes only land locally; nothing replicates.

Observation: the failure message ("concurrent writes lost") is wrong for this specific cause — the writes weren't merge-conflicted, they were simply never sent. We'd want the test to differentiate "no-sync" from "merge-loss". Filed as a follow-up.

### B3 — Revocation gate disabled (NOT CAUGHT)

Mutation: `mesh.js:1090-1092` change `if (this.keyring.revokedPeers.has(signed.senderId))` to `if (false && ...)` so revoked peers' messages are accepted.

`bun test`: 0 failures.
`bun scripts/e2e-user-revocation.ts`: PASS.

**Gap.** The revocation e2e only asserts the visible part of revocation (the `[revoked]` entry replicates to mesh:users). It does NOT exercise the enforcement path: that a revoked peer's subsequent writes are rejected at the receive hook. The test even acknowledges this in its header — "the full enforcement story lives in polly's accept layer; this test asserts the visible part" — and we've been trusting polly's tests for the rest. But:

- We don't run polly's own test suite as part of fairfox CI.
- An attacker (or a polly regression) that disables the gate would never fail any of our 75 unit tests or 11 e2es.

Improvement targets:
1. Add an e2e that has a revoked peer attempt to write to `chat:main` (or any mesh doc) and assert that the write does NOT appear on the admin's view. The brief CLI write needs to actually try after the revocation has propagated; the `chat send` CLI from a revoked keyring is a natural carrier.
2. Either add an integration test that exercises `MeshNetworkAdapter.tryUnwrap` with a revoked-sender envelope and asserts `undefined` return, OR vendor a copy of polly's revocation tests so they run on every install.

### B4 — `$meshState.value =` setter swallows writes

Mutation: `mesh.js:1723-1725` setter body `inner.value = next` → no-op.

Caught immediately by `e2e-mesh-roundtrip` — `mesh init` fails with `addEndorsementToDevice: unknown peer …` because the bootstrap user write disappears, so reads return the initial empty doc. <5 s detection. No gap.

### B5 — `cloneDoc` returns an empty object

Mutation: `mesh.js:1732-1734` `return JSON.parse(JSON.stringify(doc))` → `return {}`.

Caught immediately by `e2e-mesh-roundtrip` — `mesh init` fails with `TypeError: undefined is not an object (evaluating 'iB.value.devices[A]')`. <5 s detection. No gap, but the failure message is a TypeError rather than something protocol-meaningful — the next layer up could carry a clearer error if we added schema-shape assertions on `$meshState` reads.

## Headline takeaways

1. **Negative-case unit tests are the cheapest, fastest mutation killers.** B1 was caught in <1 s by 4 unit tests that directly assert tampered signatures are rejected. Every security-critical predicate in fairfox should have an analogous "rejects bad input" unit test. We have them for endorsement, invite, and user-row signatures. We do NOT have an equivalent for `MeshNetworkAdapter.tryUnwrap`'s revocation path — and that's exactly what B3 exposed.

2. **e2e catches the catastrophes; it does NOT catch the security regressions.** B2/B4/B5 are catastrophes (nothing works). The e2e tier blew up immediately. B3 is subtle: everything continues to work, the data even looks right — only the security boundary has been removed. e2e tier blind to this by construction.

3. **Trusting an upstream's tests is fine until the upstream stops being trustworthy.** Our user-revocation e2e explicitly defers enforcement to polly. The 0.35.0 → 0.36.0 episode showed that polly releases can ship runtime regressions. The fix isn't to distrust polly; it's to add at least one fairfox-side test for each property fairfox's safety story depends on, so that *if* polly drifts we find out within seconds, not after a security incident.

4. **The failure message wants to be specific to the failure mode.** B2's e2e says "concurrent writes lost" when the actual cause is "no replication at all". A future revision of the test could distinguish: write from alice, settle, ask bob — if bob doesn't see alice's write at all, the failure is replication, not merge.

## Follow-up tickets

- [ ] **e2e-revoke-then-write**: paired admin → revokes member → revoked member tries to `chat send` → admin's `chat dump` does NOT show the write. (Closes B3.)
- [ ] **Sharper failure messages in agenda-concurrent**: distinguish "no replication" from "concurrent merge loss". (Surfaces B2 in less ambiguous terms.)
- [ ] **Schema-shape assertion at $meshState read sites**: when the doc is missing top-level keys you expect, fail with a protocol-meaningful error rather than letting a downstream `undefined.devices` TypeError do the talking. (Surfaces B5 better.)
