# 0009 — Convergence as a load-bearing invariant

**Status:** Draft
**Date:** 2026-05-15

## Context and problem statement

`PRODUCT_VISION.md` states what fairfox is supposed to feel like in
two load-bearing sentences. The first is the cross-device read:

> As a user, I want to open any of my paired devices and see what
> my partner edited five minutes ago, with no refresh button to
> press.

The second is the offline-then-online write:

> As a user, I want my devices to keep doing everything except
> exchange with other devices when they can't reach each other —
> write, edit, search, browse my own copy — and to catch up with
> everyone else automatically once contact resumes.

Both sentences require the same property of the system: any two
devices that share a paired household, given any path between them
and given enough wall-clock time, converge to the same view of
every household-shared document. The product story doesn't survive
without it.

The reality across a single debugging session on 2026-05-15 was:

- The daemon's `mesh:devices` doc held 2 entries; the iPhone's
  local view held 89; the disagreement was stable across hours of
  active sync because polly's `applyTopLevel` resolved the
  conflicting top-level assignment by actor-id hash and silently
  discarded the loser. (fairfox#22)
- The desktop's WebRTC slot to the daemon sat in `ice=new
  conn=new dc=connecting` indefinitely after a silent rejection in
  `setLocalDescription`. The recovery loop short-circuited on
  `slot-already-exists` every sweep; polly's teardown only fires
  for `disconnected | failed | closed`, none of which `new`
  matches. (polly#109; fairfox#23)
- A later snapshot of the same desktop showed the slot in
  `sig=stable ice=connected conn=connected dc=open` — every state
  field reporting health — with every timestamp 1168 seconds old
  because the remote daemon process had been killed without an
  OS-layer FIN. Polly has no application-layer liveness check;
  the slot stays "alive" until ICE keepalives fail, which can
  take minutes. (polly#110)
- The desktop's and iPhone's mesh fingerprints diverged
  (`aea75ad5` vs `6a4dcbf1`) despite sharing the same user
  identity, same `mesh:meta` doc id, and successful WebRTC
  exchange. The fingerprint comes from
  `keyring.documentKeys.get(DEFAULT_MESH_KEY_ID)`; the divergence
  means the two devices hold different cryptographic keys under
  that ID. (fairfox#24)
- The desktop's keyring reported `known in keyring: 1` (the
  daemon only); the iPhone's reported `known in keyring: 2` (the
  daemon and the desktop). The desktop had no pair record for the
  iPhone and would not initiate to it, even though both saw each
  other on the signalling roster. Keyring updates are pair-time
  messages, not a replicated state — a device offline at the
  moment of pair never learns about the new peer.
- An orphan peerId (`9317f0554ea9`) appeared on the signalling
  roster with no matching keyring entry on any of the user's
  known devices. Origin unidentified; the signalling presence
  channel offers no provenance.
- The user's recovery-blob workflow produced a freshly-paired
  identity rather than restoring the prior keyring on at least one
  occasion ("kinda reconnects again" — the iPhone's peerId after
  re-pair was `8263…` in some cases and a new value in others),
  suggesting the recovery path doesn't reliably round-trip the
  full keyring.

Each item is a real bug with its own ticket. The pattern across
them is that *convergence is not load-bearing* in the current
architecture — it's an emergent property that fails open. Today's
debugging hour was almost entirely consumed by ad-hoc recovery:
"hard-reload this tab," "rotate this secret," "manually run
`peers gc-revoked`," "wipe the iPhone's IDB and re-pair," "re-issue
an invite from the daemon with the desktop tab open." None of those
recoveries are surfaced in `PRODUCT_VISION.md`, and none of them
should ever be required.

This ADR commits to convergence as a load-bearing invariant of
fairfox and lists the design changes that follow from that
commitment.

## The invariant

> For any two devices A and B that share a paired household, given
> any path from A to B (directly via signalling+RTC, or
> eventually via a third device acting as a sync hop), and given
> enough wall-clock time, A and B converge on byte-identical
> contents of every household-shared `$meshState` document. No
> user action — no refresh, no re-pair, no `gc-revoked`, no
> `mesh reconcile` — is ever required to bring this convergence
> about.

Two operational corollaries follow:

- The same invariant applies to every form of household-shared
  state, including those currently stored outside `$meshState`
  (keyrings, pair records, document keys). Anything required for
  one paired device to communicate with another must converge.
- Manual recovery tools may exist for forensic and operator use
  but must not appear in any user-facing workflow. The phrase "to
  fix it, run X" is the smell that names a violated invariant.

## Decision drivers

- Every failure mode catalogued above is silent in normal
  operation. None of them surface as an error; all of them
  surface as "nothing's happening" or as a state divergence the
  user has to recognise themselves. The current architecture has
  no mechanism to detect or report a violated invariant.
- The patches we have been shipping ("be more careful in this one
  caller") are per-call-site discipline. They do not encode the
  invariant; they fix one instance at a time. The next caller to
  forget the rule will reintroduce the failure.
- The cost of carrying these failure modes is paid every time a
  user opens fairfox after their device was offline, after the
  daemon restarted, or after a re-pair. The current production
  experience is "kinda reconnects again," which is not the
  experience PRODUCT_VISION.md describes.
- The mesh has no central authority, so the convergence invariant
  cannot be enforced server-side. It must be a property of the
  protocol and the data shapes themselves.

## Decision

Commit to the convergence invariant. Reshape outstanding work
around six non-negotiables that each rule out one or more failure
modes by construction:

### 1. One legal write pattern for `$meshState`

`$meshState` exposes `handle.change((doc) => { ... })` for
per-key writes. The `.value = next` setter is removed (or made a
TypeScript-level build error in fairfox via a wrapper that
forbids assignment). polly's `applyTopLevel` is correspondingly
deprecated. Every existing call site of `.value = ...` is
audited and rewritten.

This eliminates failure mode #1 (silent merge loss to actor-id
hash). Convergence becomes a property of the doc shape, not of
caller discipline.

### 2. Slot self-heal in polly

Every WebRTC slot has an application-layer liveness watchdog.
The slot tracks `lastInboundAt`; if `performance.now() -
lastInboundAt > IDLE_TIMEOUT_MS` (60–120s), the slot is torn
down via the existing `handlePeerLeft` path. The recovery loop's
next sweep creates a fresh slot. Additionally, `initiateOffer`
is wrapped in a `.catch` that tears down the slot on rejection;
the slot is registered *after* `setLocalDescription` succeeds,
not before. (Equivalent to landing polly#109 and polly#110.)

This eliminates failure modes #2 and #3 (silent-throw-at-init and
dead-but-connected slots).

### 3. Keyring lives in `$meshState`

The portion of the keyring that gates WebRTC initiation — the
known-peers set, the pair records — moves into a
`mesh:known-peers` document (or similar). Pair-time messages
become normal `handle.change` writes to this doc. Devices that
are offline at the moment of a pair pick up the new peer via
ordinary CRDT sync the next time they connect.

This eliminates failure mode #5 (one-sided keyring after offline
pair).

Identity-keypair material stays local — the long-lived secret
key never leaves the device. Only the parts of the keyring that
must agree across devices migrate to mesh state.

### 4. One mesh key, one moment

The mesh's primary document key is generated at `mesh init`,
written into the admin's keyring under `DEFAULT_MESH_KEY_ID`, and
distributed verbatim by every subsequent invite. The pairing
protocol verifies that the joining device received exactly the
admin's key under that ID before treating the pair as complete.
The key is never rotated, never re-derived per-device.

A device that holds a different key under `DEFAULT_MESH_KEY_ID`
is, by construction, on a different mesh — and the pair flow
should refuse to complete.

This eliminates failure mode #4 (document key drift between
devices that signalling treats as on-the-same-mesh).

### 5. Recovery blob is the authoritative restore

The recovery blob is the byte-canonical serialised keyring at
the moment of export. Restoring from a blob reproduces every
byte of the original keyring on the target device, including the
identity keypair, every document key, every pair record, and
every endorsement. There is no path by which restoring produces
a "fresh" identity instead of the encoded one.

A round-trip test in `scripts/` exercises export-then-import on a
fresh machine and asserts byte-equality across the restored
keyring.

This eliminates failure mode #7 (recovery blob fidelity).

### 6. Continuous convergence test in CI

A `scripts/e2e-convergence.ts` extends `scripts/e2e-two-device-sync.ts`
to exercise the full failure surface:

- Two real browsers + one daemon, paired via the documented
  invite flow.
- Write on each, verify mutual convergence.
- Disconnect each in turn (close tab, kill daemon process, drop
  signalling), reconnect, write during the gap on the still-online
  side, verify the offline side converges on reconnect.
- Restart the daemon process (preserving its keyring), verify the
  surviving browsers detect the slot death and reform.
- Pair a third device with one of the browsers offline; bring
  that browser back; verify it learns the new pairing without
  manual intervention.
- Export a recovery blob, wipe the source device, restore the
  blob on a fresh machine, verify the restored device converges
  with the rest of the mesh on every shared document.

Non-zero exit on any convergence timeout. CI runs this on every
PR that touches the convergence-load-bearing packages
(`packages/shared`, `packages/cli`, polly bumps).

This eliminates the *recurrence* of every failure mode by making
their absence a continuously-verified property.

## Out of scope for this ADR

- **The orphan signalling presence** (failure mode #6 — the
  unknown `9317…` peerId) is a signalling-layer observability
  question, not a convergence question. The presence channel
  doesn't carry provenance and the relay doesn't expose its
  roster history. Tracked as a separate ADR / ticket if it
  proves to be load-bearing in practice; convergence is unaffected
  because `not-in-keyring` already gates RTC initiation. Logging
  improvements on the relay would be helpful but are not part of
  this decision.
- **Document-history compaction** (ADR 0008) interacts with this
  ADR but is independently motivated and already partially
  shipped. Where ADR 0008 has a top-level-assign pattern of its
  own (`documentIndexState.value = {...}` at
  `compact-mesh-doc.ts:158`), it gets rewritten under
  non-negotiable #1.

## Consequences

### What changes

- polly gets two new constraints: (a) `$meshState` no longer
  exposes a value-setter on docs that participate in convergence,
  (b) every WebRTC slot has a liveness watchdog and `initiateOffer`
  is error-handled. Both need work upstream.
- `packages/shared` grows a `mesh:known-peers` doc with the
  pair-time protocol writing into it. The pairing flow's
  signalling messages become trigger events for a single
  `handle.change` write rather than a delivery vehicle for the
  record itself.
- The pairing protocol grows a document-key verification step.
  A pair that completes the signalling handshake but produces a
  document-key mismatch fails closed.
- Every `.value = ...` call site against a `$meshState` wrapper
  is audited; current known cases are `mesh-meta-state.ts:49`,
  `compact-mesh-doc.ts:158-161`, `devices-state.ts:280-283`
  (fallback path). All rewrite to `handle.change`.
- The recovery-blob path gets a structural integrity test in
  `scripts/`.
- The CLI's `mesh reconcile` / `peers gc-revoked` are downgraded
  from "user-facing recovery tools" to "operator-only diagnostics."
  Their help text and discoverability changes accordingly.

### What this costs

- The polly changes are upstream. We control polly, but each
  change has to land in polly's release stream and be picked up
  by a polly bump in fairfox. Adds latency to forward motion on
  the fairfox side.
- Moving the keyring's shared portion into `$meshState` is a
  protocol change. Devices on the old protocol need a one-time
  migration path (or a forced re-pair). The blast radius is
  every paired device in every fairfox household, which is
  currently small but won't stay that way.
- The pair-flow verification step adds a round-trip to the
  pairing ceremony. Practically negligible; worth listing.
- The continuous convergence test in CI is slow (real Chrome,
  real daemon, real disconnects). It belongs on PRs that touch
  the convergence surface, not on every PR.

### What this rules out

- Future patches of the shape "be more careful in this one
  caller." Every such patch is, going forward, a signal that the
  invariant isn't fully encoded yet.
- Adding a new `$meshState` doc without specifying its write
  pattern. New docs come with a doc-shape declaration that
  rejects top-level assignment.
- Document-key rotation. We may want it later; we don't have it
  now and the invariant rules it out without a separate ADR.

## Open questions

- The `$meshState.value` setter is used today not only for
  doc-content writes but also as a synchronous mirror for the
  signal subscribers reading `.value`. Removing the setter has a
  subscriber-API implication that needs to be designed. Possible
  shapes: the setter stays internal to polly (driven by the
  CRDT-side change subscription) and is removed from the public
  type surface; or it remains but is type-narrowed so attempts to
  reassign trigger a compile error in fairfox.
- Whether `mesh:known-peers` is one document per household or
  one per user. Per-household is simpler and matches the current
  keyring shape; per-user gives finer-grained access control.
  Likely per-household; revisit when implementing.
- The migration path for households already on the old keyring
  protocol. Most likely: a one-time `fairfox mesh upgrade-keyring`
  CLI verb that reads the local keyring, writes a seeded
  `mesh:known-peers` doc, and triggers a sync round. Each device
  runs it once. Detail to be worked out.
- Whether the continuous convergence test should run against the
  production signalling relay or against a local one spawned for
  the test. Local is faster and more deterministic; production
  catches relay-side regressions. Probably both, on different
  cadences.
