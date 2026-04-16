# 0006 — Deprecate-and-rebuild migration for existing sub-apps

**Status:** Accepted (revised 2026-04-16, supersedes 2026-04-15 original)
**Date:** 2026-04-16

## Context and problem statement

Two sub-apps already exist: `packages/struggle` (a game engine and CMS-like library) and `packages/todo` (a project tracker with agenda). Both predate the `$meshState` baseline and use SQLite databases, server-side Elysia routes, and documented biome relaxations. A focused audit confirmed that the library and game engine inside `packages/struggle` are cleanly separable (zero shared schema, zero shared routes).

The migration target has changed since the original ADR: instead of rebuilding onto server-backed SQLite with Polly push, sub-apps rebuild onto `$meshState` with peer-to-peer CRDT replication. The migration format changes accordingly — legacy data is exported from SQLite as JSON and imported into Automerge documents.

## Decision drivers

- In-place migration produces extended hybrid states that are hard to reason about and easy to break.
- The architectural shift from server-centric to peer-to-peer is too large to retrofit incrementally.
- The library inside `packages/struggle` is cleanly separable, so the rebuild can also do the split.
- Legacy data is exportable via the existing `/api/backup` endpoints and importable into Automerge documents.

## Decision

We will rebuild `packages/struggle` as two new sub-apps — `the-struggle` (the reader-facing game) and `library` (the struggle-specific CMS) — fresh on the `$meshState` baseline. We will rebuild `packages/todo` as a new sub-app fresh on the baseline. The old packages remain in place and continue to serve users until each new one is ready; content migrates by exporting legacy JSON via the backup endpoints and writing it into `$meshState` documents; the old package is then retired.

The conformance checks explicitly skip `packages/struggle` and `packages/todo` while they exist, marked as legacy on the way out.

> In the context of two existing sub-apps that violate the new `$meshState` baseline and a clean separation already audited between the struggle game and its library, facing the choice between in-place migration and rebuild, we decided for deprecate-and-rebuild with content migration via JSON export into Automerge documents, against in-place migration, to achieve clean sub-apps with no legacy carve-outs.

## Considered alternatives

- **In-place migration.** Rejected because it produces extended hybrid states and risks introducing bugs in working code.
- **Throw away old sub-apps without data migration.** Rejected because both contain real content.
- **Keep old sub-apps permanently grandfathered.** Rejected because permanent carve-outs weaken the platform rule.

## Consequences

**Good:**
- Each new sub-app starts clean on the `$meshState` baseline with no legacy compromises.
- The library/game split happens as a side-effect of the rebuild.
- Old sub-apps keep working until the new ones are ready.
- The migration exercises the JSON-to-Automerge import path in a real scenario.

**Bad:**
- The total work is larger than an in-place migration.
- For a period, fairfox contains two versions of struggle and two versions of todo.
- The conformance checks temporarily carry a skip list for the legacy packages.
