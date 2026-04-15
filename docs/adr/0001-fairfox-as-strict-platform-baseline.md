# 0001 — Fairfox as a strict platform baseline

**Status:** Accepted
**Date:** 2026-04-15

## Context and problem statement

Fairfox today is a small Bun monorepo with three sub-apps that grew by transplanting two existing projects. The result is three frontends with three different stacks, two of them carrying documented biome and tsconfig relaxations, no shared component library, no shared client convention, and no enforced agreement between frontend and backend types. The plan over the next year is to grow fairfox to roughly ten sub-apps — Speakwell, the family-phone PWAs, agenda, the library, the rebuilt The Struggle, and others — and the monorepo needs to function as a stable platform that makes new sub-apps boring to start and resistant to drift.

Without a strict baseline installed before that growth happens, ten sub-apps will become ten dialects of fairfox, and the cost of holding it together will compound until the platform stops being one thing.

## Decision drivers

- The user has prior experience with rigorous platform discipline in Lingua and has seen it pay off.
- Retrofitting strict rules across many sub-apps is much more expensive than installing them up front.
- A central concern is preventing slow architectural decay as the number of sub-apps grows.
- Past data loss in The Struggle has made data resilience a top priority, which only a uniform platform can guarantee.
- The user wants reusable primitives so that building the next sub-app is mostly a copy-paste away.

## Decision

We will treat fairfox as a strict platform with a single non-negotiable baseline that every sub-app must conform to from day one. Strictness is enforced mechanically by a CI conformance test, not by convention. There are no per-package biome relaxations, no per-sub-app durability tiers, and no opt-outs. The baseline applies uniformly to every sub-app the platform hosts.

The specific shape of the baseline is captured in the other ADRs in this directory: state and events (0002), authentication (0003), data resilience (0004), UI primitives (0005), and the migration approach for existing sub-apps (0006).

> In the context of growing fairfox from three sub-apps to roughly ten over the next year, facing the risk of slow architectural rot across many small projects, we decided for a strict platform baseline enforced by a CI conformance test, accepting higher up-front investment in shared infrastructure and template maintenance, to gain the property that every new sub-app starts on solid ground and stays there.

## Considered alternatives

- **Per-sub-app discretion (status quo).** Each sub-app picks its own patterns. Fast to start, predictable rot.
- **Soft conventions documented in CLAUDE.md.** Rules captured but not enforced. Holds briefly, drifts under pressure.
- **Strict baseline with a CI conformance test (chosen).** Enforced mechanically, scales to many sub-apps, demands real investment up front.

## Consequences

**Good:**
- Adding a new sub-app is `cp -r packages/_template packages/newthing` and editing names; the architectural decisions are already made.
- Cross-cutting concerns like auth, backup, logging, and real-time sync are solved once in shared infrastructure rather than ten times inconsistently.
- The conformance test makes "is this sub-app well-formed" a yes-or-no question rather than a judgment call.
- Future readers of any sub-app can reason about it the same way.

**Bad:**
- The first wave of work is all infrastructure; there is no shippable feature until the baseline exists.
- The strictness will sometimes feel like friction when a quick hack would do, and the rule has to hold anyway.
- Existing sub-apps cannot be migrated in place; they have to be rebuilt fresh, which is more total work than a localised refactor.
- The conformance test must itself be maintained as the platform evolves; a stale test is worse than no test.
