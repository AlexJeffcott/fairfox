------------------------------- MODULE Orphan -------------------------------
\* A fixture for a red change of the check "tlc" (packages/devctl/src/checks.ts):
\* a spec with no Orphan.cfg beside it, which TLC would never check.
VARIABLE x
Init == x = 0
Next == x' = x
=============================================================================
