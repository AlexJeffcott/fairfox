# Mutation testing for fairfox's polly dependency

Fairfox's safety story leans heavily on polly's mesh layer
(`@fairfox/polly/mesh`): signed envelopes, encrypted documents, peer
revocation, signalling reconnection, $meshState bridge. Whenever we
bump polly we want to know that those primitives still hold against
deliberate breakage. This directory tracks campaigns where we
intentionally break polly in `node_modules/@fairfox/polly/dist/src/`
and run our test suite to see what we catch.

The four rounds we've run:

- **`round-01.md`** — security and replication primitives (signature
  verification, network send, revocation gate, $meshState write
  bridge, doc-clone). 4/5 caught; the miss was the receive-side
  revocation gate.
- **`round-02.md`** — encryption, signalling, selective doc
  corruption. 3/5 cleanly caught, 1 conditional, 1 miss (revocation
  applied to wrong target).
- **`round-03.md`** — routing, lifecycle, authority checks. 4/5
  caught; the miss was the revocation-authority check.
- **`round-04.md`** — lifecycle, signing, framing, the persistence
  trap. 5/5 caught, including the exact `currentHandle = handle`
  bug we fixed in fairfox by inspection earlier.

Together, **17/20 mutations caught.** The three misses all live in
the revocation-enforcement boundary; the design plan to close them
is in this repo's most recent `/deliberate` output and the TODO
record `e2e-revoke-then-write.ts`.

## Running a fresh round

The protocol is deliberately manual — adding a CI harness was
considered and deferred until we had clear demand for it.

```sh
# 1. Snapshot the pristine bundle.
cp node_modules/@fairfox/polly/dist/src/mesh.js /tmp/polly-mesh-pristine.js

# 2. Edit node_modules/@fairfox/polly/dist/src/mesh.js with your
#    mutation. Keep the change minimal and bracketed by a
#    "MUTATION B<n>:" comment so a future reader knows what it is.

# 3. Rebuild the CLI bundle so e2e tests pick up the mutation.
bun run --cwd packages/cli build.ts

# 4. Run the cheapest test that targets the affected behaviour.
bun test                          # unit tier (signing, codecs, etc.)
bun scripts/e2e-mesh-roundtrip.ts # generic replication probe
bun scripts/e2e-user-revocation.ts # revocation-row visibility

# 5. Note pass/fail in a new round-NN.md.

# 6. Restore pristine before moving to the next mutation.
cp /tmp/polly-mesh-pristine.js node_modules/@fairfox/polly/dist/src/mesh.js
```

When you're done, run `bun scripts/e2e-all.ts` to confirm the
suite is back to its pre-campaign baseline.

## When to run

Re-run on every major polly bump. The 0.30 → 0.36 path during
this codebase's life included one transient regression at 0.35.0
that broke `mesh init` / `pair` and concurrent CRDT pushes —
caught only because we ran `bun scripts/e2e-all.ts` after the
bump. Mutation testing is the layer that would catch a more
subtle regression, e.g. a signature check that silently weakens.

A single round of 5 mutations is ~30 minutes of work. The cost is
worth paying once per major polly bump and once per change to the
revocation / signalling / signing surface in fairfox itself.

## Mutation menu

The mutations across rounds 1-4 are grouped here as a starter
menu. Reuse, vary, or invent new ones. The aim isn't exhaustive
coverage — it's a representative sample that exercises the
boundaries fairfox cares about.

**Cryptographic (catches: signature unit tests)**
- `verify` returns true unconditionally
- `sign` returns a constant signature
- Signature byte-offset shifted in `decodeSignedEnvelope`

**Transport (catches: e2e replication probes)**
- `MeshNetworkAdapter.send` is a no-op
- `sealEnvelope` ships plaintext
- `sendSignal` no-op
- `peer-disconnected` event swallowed
- `onPeerJoined` callback never fires
- `decodeSignedEnvelope` byte offset off by one

**State / persistence (catches: mesh-roundtrip, agenda-concurrent)**
- `$crdtState` setter swallows writes
- `currentHandle` never published (the persistence bug we hit)
- `cloneDoc` returns `{}` or by reference
- `applyTopLevel` skips a specific top-level key
- `fieldEquals` always returns true

**Routing**
- `deserialiseMessage` swaps senderId / targetId

**Revocation enforcement (still uncaught)**
- Receive-side gate skipped
- `applyRevocation` adds the wrong peer
- `decodeRevocation` skips authority check
