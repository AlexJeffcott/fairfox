----------------------------- MODULE TwoWriters -----------------------------
(***************************************************************************)
(* Step 0a: the one hand-written spec, there to show that TLC is wired     *)
(* (S4). It models no protocol of Fairfox.                                 *)
(*                                                                         *)
(* Two writers each add one to a shared count, in two steps: read the      *)
(* count, then write what was read, plus one. A writer takes the lock to   *)
(* read and gives it back when it writes, so no write lands between        *)
(* another writer's read and its write. Without the lock TLC finds the     *)
(* order in which both read 0 and the count ends at 1: a lost update, the  *)
(* kind of defect of ordering a spec is written to find.                   *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

Writers == {"a", "b"}

VARIABLES count, lock, pc, seen

vars == <<count, lock, pc, seen>>

TypeOK ==
  /\ count \in 0..Cardinality(Writers)
  /\ lock \in Writers \cup {"free"}
  /\ pc \in [Writers -> {"read", "write", "done"}]
  /\ seen \in [Writers -> 0..Cardinality(Writers)]

Init ==
  /\ count = 0
  /\ lock = "free"
  /\ pc = [w \in Writers |-> "read"]
  /\ seen = [w \in Writers |-> 0]

Read(w) ==
  /\ pc[w] = "read"
  /\ lock = "free"
  /\ lock' = w
  /\ seen' = [seen EXCEPT ![w] = count]
  /\ pc' = [pc EXCEPT ![w] = "write"]
  /\ UNCHANGED count

Write(w) ==
  /\ pc[w] = "write"
  /\ count' = seen[w] + 1
  /\ lock' = "free"
  /\ pc' = [pc EXCEPT ![w] = "done"]
  /\ UNCHANGED seen

Done == \A w \in Writers : pc[w] = "done"

\* Once both have written, the model stays where it is: an end, not a deadlock.
Next ==
  \/ \E w \in Writers : Read(w) \/ Write(w)
  \/ (Done /\ UNCHANGED vars)

Spec == Init /\ [][Next]_vars

\* Once both have written, the count holds both updates.
NoLostUpdate == Done => count = Cardinality(Writers)
=============================================================================
