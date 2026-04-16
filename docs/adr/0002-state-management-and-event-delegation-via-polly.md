# 0002 — State management and event delegation via @fairfox/polly

**Status:** Accepted (revised 2026-04-16, supersedes 2026-04-15 original)
**Date:** 2026-04-16

## Context and problem statement

Every fairfox sub-app needs reactive state, a way to sync that state across devices, and a clean way to wire UI events to behaviour. The user's own framework `@fairfox/polly` provides state primitives, formal verification via TLA+, and — since v0.22.0 — peer-to-peer CRDT replication via `$meshState`. The event delegation pattern from Lingua (centralised `data-action` attributes, no inline `onClick`) has proven itself and is already ported into `@fairfox/ui`.

## Decision drivers

- `@fairfox/polly` already provides the entire state, sync, and verification stack in one place.
- `$meshState` makes every device a full encrypted replica with peer-to-peer sync over WebRTC, giving fairfox inherent data resilience.
- Lingua's centralised event-delegation pattern works well and the user wants to continue it.
- TLA+ verification of lifecycle state catches bugs that integration tests miss.

## Decision

We will use `@fairfox/polly` as the single state and data-fetching primitive across every fairfox sub-app. The state tier is `$meshState` for all shared sub-app data — every device holds a full Automerge CRDT replica, synced peer-to-peer over encrypted WebRTC. The three-tier state pattern adapts as follows:

- **Tier 1 (mesh-replicated):** `$meshState` documents for all shared data — tasks, agenda items, library entries, game state, anything that should survive device loss and stay consistent across the family's devices.
- **Tier 2 (local domain):** Module-scoped Preact signals for sub-app domain logic that doesn't need replication — filter state, pagination cursors, editor selections.
- **Tier 3 (non-serializable):** Local signals for DOM refs, Promise callbacks, transient loading flags.

Components never receive `onClick`, `onChange`, `onSubmit`, or `onBlur` props. User actions are declared via `data-action` attributes and routed through the shared event-delegation layer into a per-sub-app action registry. Action handlers mutate `$meshState` documents; the CRDT sync layer propagates changes to every connected peer automatically.

TLA+ verification is part of the baseline. Every sub-app's modal and form lifecycle ships with `requires`/`ensures` guards and a verification config.

> In the context of building ten sub-apps that all need reactive state and cross-device sync, facing the risk of each sub-app inventing its own state pattern, we decided for `$meshState` as the universal state primitive plus centralised data-action event delegation, accepting the CRDT learning curve, to gain peer-to-peer encrypted replication and a single way of writing every fairfox interaction.

## Considered alternatives

- **Server-centric Polly ($sharedState + Elysia plugin push).** The original ADR 0002. Rejected because the server becomes a single point of failure for state and limits the durability story to operational backups.
- **$peerState (server as a peer).** Server participates as a data peer. Rejected because the user chose "$meshState for everything" — the server should never be on the data path.
- **Per-sub-app state choice.** Rejected because it produces inconsistent state patterns and fragments the sync story.

## Consequences

**Good:**
- One state pattern across every sub-app; moving between them is cognitively free.
- Data resilience is inherent: every paired device is a full replica. No backup system to operate.
- Offline-first is implicit: edits always work locally, sync happens when peers connect.
- Action handlers are enumerable by grepping for `data-action=`.
- TLA+ verification catches lifecycle bugs before they ship.

**Bad:**
- Automerge CRDTs have overhead: documents are larger than equivalent rows, and merge semantics require understanding.
- Debugging distributed CRDT state across multiple peers is harder than debugging a single SQLite database.
- The platform is tightly coupled to Polly and Automerge; replacing either would touch every sub-app.
- WebRTC connectivity is less reliable than a direct WebSocket to a server; NAT traversal and TURN may be needed.
