# 0004 — Data resilience via twice-daily JSON dumps to GitHub

**Status:** Accepted
**Date:** 2026-04-15

## Context and problem statement

The user has experienced serious data loss in The Struggle and has flagged data resilience as a top concern for the new platform. Fairfox will host roughly ten SQLite databases on a Railway volume, each owned by a sub-app. The user prefers one unified backup mechanism over a tiered system that treats some sub-apps as more durable than others, on the grounds that first-class and second-class durability is exactly the kind of inconsistency the platform is trying to avoid.

The original Struggle data loss was caused by a policy failure — code that auto-deleted the database on schema mismatch — not by a hardware or platform failure. Any backup story that does not also prevent that failure mode is incomplete.

## Decision drivers

- Past data loss in The Struggle was caused by a policy failure; the new system must make that mode mechanically impossible.
- The user values operational simplicity and rejects a two-tier durability model.
- The user wants backups in an ecosystem he already trusts (GitHub) rather than a third-party object store.
- Polly's `$syncedState` plus WebSocket broadcast already replicates state to every connected client in real-time, which means the server is rarely the only copy of recent state.
- A backup that is never restored is not actually a backup.

## Decision

Every fairfox sub-app registers its SQLite database with a shared backup runner in `@fairfox/shared`. The conformance test refuses to ship a sub-app that does not register, so there is no way to add a database that escapes the backup chain.

Twice daily, at 06:00 and 18:00 local time, the runner walks the registered databases, dumps each one to JSON, and commits the result to a private GitHub repository (`AlexJeffcott/fairfox-backups`). The dump includes both schema and data so the backup repo is self-sufficient: a fresh restore needs nothing other than the repo itself.

A diff guardrail refuses to push if any sub-app's dump is more than 20% smaller than the previous one and raises an alert instead. This is the specific mechanism that catches the failure mode that caused the past Struggle data loss — silent data deletion being faithfully recorded over the previous healthy state. The same guardrail catches genuine large deletions, which then need a human acknowledgement before the new dump replaces the old one.

Schema migrations always trigger a fresh dump tagged `pre-migration-<sub-app>-<version>` before applying. A failed migration restores from the tagged commit and the diagnostic is whatever the migration did. The migrations runner is the only blessed way to alter a database schema; auto-deletion on schema mismatch is forbidden by code and by the conformance test.

A monthly automated restore drill clones the backup repo fresh, picks the latest dump for each sub-app, rebuilds throwaway databases, runs a sanity query against each, and reports success or failure. Dead-man alerting via healthchecks.io fires if any of the above stops happening.

The backup repo is rolled annually as commit history grows, archiving the previous year's repo and starting a fresh one.

> In the context of hosting ten family databases with a history of one serious data loss event, facing the requirement that every sub-app must be backed up the same way, we decided for twice-daily JSON dumps to a private GitHub repository with a diff guardrail, pre-migration tagged commits, and a monthly restore drill, against Litestream or per-sub-app durability tiers, to achieve one operational story for every database, accepting a worst-case loss window of twelve hours for the catastrophic failure where no client also held a recent copy.

## Considered alternatives

- **Litestream to Backblaze B2 plus daily snapshots.** Rejected because it introduced a two-tier system with first-class and second-class sub-apps, and added a third-party storage dependency.
- **Hourly JSON dumps.** Considered, but twice-daily is sufficient given that Polly replicates state to connected clients in real-time, and the lower commit volume keeps the backup repo healthy long-term.
- **Manual periodic backups.** Rejected as too easy to forget. The point of mechanical enforcement is that no human attention is required for the system to keep working.

## Consequences

**Good:**
- One backup mechanism, one restore path, one conformance check; no decisions to make per sub-app.
- The backup repo lives in an ecosystem the user already trusts and has independent durability from Railway.
- The diff guardrail catches the exact failure mode that caused the past Struggle data loss.
- The monthly restore drill exercises the backup chain continuously, so a broken backup chain is found immediately rather than during an emergency.
- Cloning the backup repo to AJT's Mac via cron gives him a continuously-updated local mirror for free.
- The backup repo is self-sufficient; restoring fairfox from zero requires only the repo.

**Bad:**
- The maximum loss window is twelve hours for the catastrophic case where no client held a recent copy in memory.
- Real-time chat or collaborative features rely on Polly's client-side replication for durability between dumps; the server is not the only copy of recent state, but it is the copy that survives a process restart.
- The backup repo will need to be rolled annually as commit history grows.
- A misbehaving migration that the diff guardrail allows through can still corrupt a database between dumps; the pre-migration tagged commit is the recovery path.
