# 0006 — Deprecate-and-rebuild migration for existing sub-apps

**Status:** Accepted
**Date:** 2026-04-15

## Context and problem statement

Two sub-apps already exist in fairfox: `packages/struggle` (a transplanted creative-writing project containing both an interactive game engine and a CMS-like library of references and docs) and `packages/todo` (a transplanted project tracker). Both predate the strict baseline being established and have documented biome and tsconfig relaxations. Migrating them in place would mean rewriting their event models, replacing inline handlers with data-action delegation, restructuring state into Polly stores, and refactoring without a clear demarcation between "old shape" and "new shape." The result would be an extended period during which each sub-app is half old and half new, hard to reason about, and easy to break.

A focused audit of `packages/struggle` confirmed that the library and the game engine are cleanly separable: zero shared schema, zero shared routes, zero shared frontend code. The only integration point is the shared SQLite file. This makes a split-and-rebuild not only possible but mechanical.

## Decision drivers

- In-place migration produces a long stretch where the sub-app is in an intermediate state, which is hard to reason about and easy to break.
- A fresh build on the baseline produces a clean reference implementation with no legacy carve-outs.
- The library inside `packages/struggle` is cleanly separable from the game engine, so the rebuild can also do the split into two new sub-apps.
- Data migration from old to new is a JSON dump and load using the same backup format the platform already needs (ADR 0004).
- Every legacy carve-out weakens the strictness rule by precedent; eliminating them entirely is more honest than grandfathering them.

## Decision

We will rebuild `packages/struggle` as two new sub-apps — `the-struggle` (the reader-facing game) and `library` (the struggle-specific CMS) — fresh on the baseline. We will rebuild `packages/todo` as a new sub-app fresh on the baseline. The old packages remain in place and continue to serve users until each new one is ready, then content migrates via the platform backup format and the old package is retired.

The conformance test will explicitly skip `packages/struggle` and `packages/todo` while they exist, marked as legacy on the way out. The skip list is itself part of the test, not a per-package opt-out, so once a new sub-app replaces an old one the entry is removed and any future drift fails the build.

The order of work is captured in [`../plans/baseline-build-order.md`](../plans/baseline-build-order.md): the baseline is built first, the new The Struggle and library sub-apps are built second as the proving grounds for the baseline against varied application shapes, and the new todo sub-app is built third because todo is the largest migration and benefits most from a baseline that has already proven itself on simpler ground.

> In the context of two existing sub-apps that violate the new baseline and a clean separation already audited between the struggle game and its library, facing the choice between in-place migration and rebuild, we decided for deprecate-and-rebuild on the baseline with content migration via the platform backup format, against in-place migration, to achieve clean reference implementations with no legacy carve-outs, accepting more total work and a temporary period where both old and new versions of each sub-app coexist.

## Considered alternatives

- **In-place migration of existing sub-apps.** Rejected because it produces extended hybrid states and risks introducing bugs in working code.
- **Throw away old sub-apps without data migration.** Rejected because both contain real content the user needs to keep.
- **Keep old sub-apps as permanently grandfathered legacy and only build new ones on the baseline.** Rejected because it leaves permanent carve-outs in the conformance test and weakens the platform rule.

## Consequences

**Good:**
- Each new sub-app starts clean with no legacy compromises and no half-migrated state.
- The library/game split happens as a side-effect of the rebuild rather than as a separate refactor.
- Old sub-apps keep working until the new ones are ready, so there is no break in service.
- The migration is a backup-restore against the platform backup format, exercising that format in a real scenario before any data is at risk.
- The rebuilt sub-apps serve as proving grounds for the baseline before any greenfield sub-app is built on it.

**Bad:**
- The total work is larger than an in-place migration would have been.
- For a period of weeks, fairfox contains two versions of struggle and two versions of todo, which is mildly confusing.
- The library data inside the current `packages/struggle` SQLite file must be carefully migrated to the new `library` sub-app's database, and the diff guardrail and pre-migration tagged commits will earn their keep here.
- The conformance test temporarily carries a skip list, which is a form of compromise even though it is mechanically tracked rather than ad-hoc.
