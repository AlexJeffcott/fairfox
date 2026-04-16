# 0001 — Fairfox as a strict platform baseline

**Status:** Accepted (revised 2026-04-16, supersedes 2026-04-15 original)
**Date:** 2026-04-16

## Context and problem statement

Fairfox is a Bun monorepo that will host roughly ten sub-apps over the next year. The three existing sub-apps each chose a different frontend stack and carry documented biome relaxations. Without a uniform baseline installed before the next wave of growth, each new sub-app will reinvent its own patterns and the cost of holding them together will compound until the platform stops being one thing.

The baseline now targets a peer-to-peer architecture: all sub-app state lives in Automerge CRDTs synced over encrypted WebRTC via `$meshState`, identity is Ed25519 key pairs per device, and the server is a stateless signaling relay that never holds or processes sub-app data. The strictness that was previously about "same server-side conventions" is now about "same peer-first conventions."

## Decision drivers

- Retrofitting strict rules across many sub-apps is much more expensive than installing them up front.
- Past data loss in The Struggle made data resilience a top concern; the peer-to-peer architecture makes resilience inherent rather than operational.
- The user has prior experience with rigorous platform discipline in Lingua and wants the same for fairfox.
- A central concern is preventing slow architectural decay as the sub-app count grows.

## Decision

We will treat fairfox as a strict platform with a single non-negotiable baseline that every sub-app must conform to from day one. Strictness is enforced mechanically by CI conformance checks, not by convention. The baseline requires:

- All sub-app state uses `$meshState` from `@fairfox/polly/mesh`. No SQLite, no server-side databases.
- Identity is Ed25519 key pairs per device, managed via a shared keyring module. No JWT cookies, no server-side session validation.
- The server exports no data routes. Its only roles are signaling relay, cron, and LLM proxy.
- UI primitives come from `@fairfox/ui`. No raw interactive HTML in sub-app source.
- User actions go through `data-action` event delegation. No inline handler props.
- All layout uses the Layout primitive. No flex or grid outside `Layout.module.css`.
- No `as` type casts. No relative imports. Strict biome and TypeScript throughout.

> In the context of growing fairfox from three sub-apps to roughly ten over the next year on a peer-to-peer encrypted mesh architecture, facing the risk of slow architectural rot, we decided for a strict platform baseline enforced by CI conformance checks, accepting higher up-front investment in shared infrastructure and template maintenance, to gain the property that every new sub-app starts on solid ground and stays there.

## Considered alternatives

- **Per-sub-app discretion.** Each sub-app picks its own patterns. Fast to start, predictable rot.
- **Soft conventions in CLAUDE.md.** Rules documented but not enforced. Holds briefly, drifts under pressure.
- **Strict baseline with CI conformance checks (chosen).** Enforced mechanically, scales to many sub-apps, demands real investment up front.

## Consequences

**Good:**
- Adding a new sub-app is a copy from `packages/_template` and editing names; the architectural decisions are already made.
- Data resilience is inherent: every paired device holds a full encrypted replica. No operational backup system to maintain.
- The conformance checks make "is this sub-app well-formed" a yes-or-no question.
- Future readers of any sub-app can reason about it the same way.

**Bad:**
- The first wave of work is all infrastructure; there is no shippable feature until the baseline exists.
- The peer-to-peer architecture is more complex than a traditional server-backed model; debugging distributed CRDT state is harder than debugging SQLite.
- Existing sub-apps cannot be migrated in place; they have to be rebuilt fresh.
- The conformance checks must themselves be maintained as the platform evolves.
