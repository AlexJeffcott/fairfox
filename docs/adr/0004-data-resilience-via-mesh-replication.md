# 0004 — Data resilience via mesh replication

**Status:** Accepted (revised 2026-04-16, supersedes 0004 "twice-daily JSON dumps")
**Date:** 2026-04-16

## Context and problem statement

The user has experienced serious data loss in The Struggle and flagged data resilience as a top concern. Under the `$meshState` architecture every device holds a full Automerge CRDT replica of every sub-app's data, synced peer-to-peer over encrypted WebRTC. The durability story is now architectural rather than operational: resilience comes from the replication topology itself, not from a backup cron job.

The original ADR 0004 designed a twice-daily JSON dump to GitHub with a diff guardrail. That approach is superseded because the primary failure mode it addressed — silent data deletion on a single authoritative server — cannot occur when there is no single authoritative copy.

## Decision drivers

- Past data loss in The Struggle was caused by a policy failure (auto-deletion on schema mismatch). Under CRDTs there is no schema mismatch that can delete data; Automerge documents evolve by adding fields, not by replacing schemas.
- The user rejected a two-tier durability model; every sub-app must have the same resilience.
- With twelve to fifteen devices across the family, the probability that all replicas are simultaneously destroyed is vanishingly small.
- The user wants one system that works for all cases.

## Decision

Data resilience is inherent in the `$meshState` architecture. Every paired device holds a full encrypted Automerge replica. Losing any device — including the server — is recoverable from any other paired device that reconnects. There is no backup system to operate, no diff guardrail, no pre-migration tagged commits, and no restore drill, because the architecture does not have the failure modes those mechanisms were designed to catch.

An optional daily GitHub archival cron runs on the server as a cold backstop for the "every device in the family was simultaneously destroyed" scenario. It exports all `$meshState` documents to JSON and commits them to `AlexJeffcott/fairfox-backups`. This archive is append-only and unencrypted (the export happens inside the server's Automerge repo, which has the document keys). It is not the primary durability mechanism and the platform functions correctly without it.

> In the context of a family hub where every device holds a full encrypted replica of every sub-app's data, facing the requirement that data resilience must be uniform and operational simplicity is valued, we decided for inherent CRDT replication as the primary durability mechanism with an optional daily GitHub archive as a cold backstop, against operational backup systems, to achieve resilience that requires no human attention and has no moving parts to fail silently.

## Considered alternatives

- **Twice-daily JSON dumps to GitHub with diff guardrail.** The original ADR 0004. Rejected because the `$meshState` architecture eliminates the failure modes it addressed and the operational complexity is unnecessary.
- **Litestream to Backblaze B2.** Rejected in an earlier revision because it introduced first-class/second-class durability tiers.
- **No archival at all.** Considered, but the cold backstop costs nothing to run and addresses the "every device destroyed" scenario that is improbable but not impossible.

## Consequences

**Good:**
- Zero operational burden for day-to-day durability; no backup cron to monitor, no restore drills.
- Resilience scales automatically with the number of paired devices; adding a device adds a replica.
- The original Struggle data-loss failure mode (auto-deletion on schema mismatch) is structurally impossible under CRDTs.
- The optional GitHub archive is simple (daily JSON commit) with no guardrails to configure or false-alarm on.

**Bad:**
- The "every device simultaneously destroyed" scenario has a loss window equal to the archival cron interval (up to 24 hours).
- The GitHub archive is unencrypted; anyone with access to the backup repo can read the exported JSON. The repo must remain private.
- CRDT documents grow monotonically; Automerge does not garbage-collect tombstones, so very long-lived documents may grow large over time.
- If all peers are offline for an extended period and one makes conflicting edits, the merge on reconnection is automatic but the result may surprise a user who expected sequential rather than concurrent semantics.
