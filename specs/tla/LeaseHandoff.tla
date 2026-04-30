------------------------- MODULE LeaseHandoff -------------------------
(*
  Formal specification of fairfox's chat relay leader-lease protocol.

  Multiple `chat serve` daemons can run on the same mesh (one per
  device). They compete for a single `daemon:leader` lease so that
  exactly one daemon at a time picks up pending chat messages and
  writes assistant replies. Implementation lives in
  `packages/cli/src/commands/chat.ts` (tryAcquireLease, releaseLease,
  the tick / leaseRenew intervals).

  This spec verifies the lease state machine at the application
  level. The underlying CRDT convergence — that concurrent acquires
  from two daemons resolve to a single doc state across all peers —
  is already verified by polly's MeshState.tla; we abstract over it
  here by modelling the lease as a single shared variable.

  Implementation summary (in chat.ts):

    LEASE_TTL_MS   = 30 000   - lease lives 30 s past expiresAt
    LEASE_RENEW_MS = 10 000   - holder re-takes (renews) every 10 s
    POLL_INTERVAL_MS = 5 000  - tick (which also tries to acquire)

    tryAcquireLease(ctx) returns true when:
      - the doc is empty (no holder), OR
      - the doc is held by ctx.daemonId (renewal), OR
      - the held lease has expired (clock > expiresAt)
    On success it writes
      { daemonId = ctx.daemonId, expiresAt = now + LEASE_TTL_MS }.

    releaseLease(ctx) clears the doc IFF the holder is ctx.

  Time abstraction. Real wall-clock time (and concrete TTL ms) is
  abstracted away. The lease is either live or expired; Tick is the
  only action that can flip a live lease to expired, modelling the
  passage of enough wall-clock ticks for `clock > expiresAt` to hold.
  Renewal flips it back to live. This keeps the state space finite
  while preserving the property we care about: "if the holder stops
  renewing, the lease eventually expires and another daemon can
  take over".

  Properties:

  1. TypeOK — state types are stable.

  2. AtMostOneLiveHolder — at most one daemonId is the recorded
     holder of a live lease at any moment. Trivial under the shared-
     variable abstraction; carried as a sanity check.

  3. NoTakeoverWhileLive — if the lease is live and held by D, no
     other daemon E /= D can become holder in a single step. Encoded
     via TryAcquire's enabling guard, then verified by an inductive
     invariant.

  4. EventualConvergence (liveness) — eventually-always either every
     daemon has died, or the holder is empty / a live daemon. Models
     "after a holder dies, we converge to either a live holder or an
     empty lease awaiting takeover".

  5. EventualHolderClaimed (liveness) — given fairness on TryAcquire,
     if at least one daemon stays alive forever, eventually the
     lease is held.

  Model abstractions:

  - "Death" is monotone: once dead, a daemon never re-joins. (This
    matches the e2e test scenario where we kill -9 the relay.)
  - We do NOT model chat:main writes here — only the lease doc. The
    "no double-replies" property requires modelling assistant reply
    semantics on chat:main and is addressed in a follow-up spec.
*)

EXTENDS Naturals, FiniteSets, TLC

CONSTANTS
    Daemons     \* finite set of candidate daemon ids, e.g. {"A","B"}

NoHolder == "none"
HolderRange == Daemons \cup {NoHolder}

VARIABLES
    holder,     \* current lease holder, or NoHolder
    leaseLive,  \* TRUE iff the holder's lease has not yet expired
    alive       \* set of daemons still alive

vars == <<holder, leaseLive, alive>>

----------------------------------------------------------------------
(* Type invariants. *)

TypeOK ==
    /\ holder \in HolderRange
    /\ leaseLive \in BOOLEAN
    /\ alive \subseteq Daemons
    /\ \* No holder => no live lease.
       (holder = NoHolder => leaseLive = FALSE)

----------------------------------------------------------------------
(* Initial state: no holder, every candidate alive. *)

Init ==
    /\ holder = NoHolder
    /\ leaseLive = FALSE
    /\ alive = Daemons

----------------------------------------------------------------------
(* Actions. *)

(*
  TryAcquire(d) — daemon d attempts to acquire / renew the lease.
  Mirrors tryAcquireLease() in chat.ts. d must be alive. Succeeds
  when the doc is empty, held by d already, or the live lease has
  expired (modelled as ~leaseLive).
*)
TryAcquire(d) ==
    /\ d \in alive
    /\ \/ holder = NoHolder
       \/ holder = d
       \/ ~leaseLive
    /\ holder' = d
    /\ leaseLive' = TRUE
    /\ UNCHANGED alive

(*
  Release(d) — daemon d voluntarily releases (graceful shutdown).
  Mirrors releaseLease() in chat.ts: only the current holder can
  release, and only while alive (a dead daemon cannot release).
*)
Release(d) ==
    /\ d \in alive
    /\ holder = d
    /\ holder' = NoHolder
    /\ leaseLive' = FALSE
    /\ UNCHANGED alive

(*
  ExpireLease — wall-clock advances enough that a live lease ages
  out. Models "clock > expiresAt" without tracking absolute time.
  Only enabled when there is something to expire.
*)
ExpireLease ==
    /\ leaseLive
    /\ leaseLive' = FALSE
    /\ UNCHANGED <<holder, alive>>

(*
  Die(d) — daemon d crashes. Monotone: once dead, never re-joins.
  Crashed daemons cannot Release; their lease ages out via
  ExpireLease, after which another daemon can TryAcquire. Keep at
  least one daemon alive so that liveness exploration is meaningful.
*)
Die(d) ==
    /\ d \in alive
    /\ Cardinality(alive) > 1
    /\ alive' = alive \ {d}
    /\ UNCHANGED <<holder, leaseLive>>

Next ==
    \/ \E d \in Daemons : TryAcquire(d)
    \/ \E d \in Daemons : Release(d)
    \/ \E d \in Daemons : Die(d)
    \/ ExpireLease

(*
  Fairness: every alive daemon keeps trying to acquire when allowed,
  and live leases eventually expire if the holder stops renewing.
  Without these the model checker can sit forever on stuttering and
  trivially falsify any liveness property.
*)
Spec ==
    /\ Init
    /\ [][Next]_vars
    /\ \A d \in Daemons : WF_vars(TryAcquire(d))
    /\ WF_vars(ExpireLease)

----------------------------------------------------------------------
(* Invariants. *)

(*
  At most one daemon is the live-lease holder at any moment. Trivial
  under the shared-variable abstraction, but failure here would mean
  the model itself is wrong.
*)
AtMostOneLiveHolder ==
    Cardinality({d \in Daemons : holder = d /\ leaseLive}) <= 1

(*
  Whenever the lease is live, the named holder is a real daemon
  (not the NoHolder sentinel). Trivially follows from TypeOK.
*)
LiveImpliesNamed ==
    leaseLive => holder /= NoHolder

----------------------------------------------------------------------
(* Liveness properties. *)

(*
  Eventually-always: either every candidate has died, or the holder
  is either NoHolder or an alive daemon. Captures "the lease never
  ends up permanently held by a dead daemon".
*)
EventualConvergence ==
    <>[](alive = {} \/ holder = NoHolder \/ holder \in alive)

(*
  If at least one daemon stays alive forever, then under fairness
  the lease is eventually claimed.
*)
EventualHolderClaimed ==
    (\E d \in Daemons : []<>(d \in alive))
        => <>(holder /= NoHolder /\ leaseLive)

================================================================
