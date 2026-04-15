# 0002 — State management and event delegation via @fairfox/polly

**Status:** Accepted
**Date:** 2026-04-15

## Context and problem statement

Every fairfox sub-app needs reactive state, async data fetching, real-time sync between server and connected clients, and a clean way to wire UI events to behaviour. Without a single answer, each sub-app will choose its own and the platform will fragment. The user already has a battle-tested pattern from Lingua: Polly stores hold signals, async data uses `$resource`, the UI uses centralised event delegation via `data-action` attributes (no inline `onClick`), and load-bearing lifecycle state is verified with TLA+. The framework `@fairfox/polly` already exists and is the user's own.

## Decision drivers

- `@fairfox/polly` already provides state primitives, async resources, an Elysia plugin for client-server state sync, WebSocket broadcast, offline support, and TLA+ verification — the whole stack in one place.
- Lingua's centralised event-delegation pattern has worked well and the user wants to continue it.
- A unified state architecture across sub-apps is more valuable than letting each one choose, because moving between sub-apps becomes cognitively free.
- TLA+ verification of lifecycle state catches a class of bugs that integration tests miss entirely.

## Decision

We will use `@fairfox/polly` as the single state and data-fetching primitive across every fairfox sub-app. Every sub-app mounts the Polly Elysia plugin to get state sync, broadcast, and offline support. Components never receive `onClick`, `onChange`, or `onSubmit` props; user actions are declared via `data-action` attributes and routed through a shared event-delegation layer ported from Lingua, dispatched into a per-sub-app action registry, and handled by Polly store methods. The three-tier state pattern from Lingua applies: verified `$sharedState` for load-bearing serializable state, module-scoped signals for app domain logic, and local-only signals for non-serializable references.

TLA+ verification is part of the baseline. Every sub-app's modal and form lifecycle ships with `requires`/`ensures` guards and a verification config; the conformance test runs `polly verify` and refuses to ship a sub-app whose handlers do not satisfy their declared properties.

> In the context of building ten sub-apps that all need reactive state, real-time sync, and clean event handling, facing the risk of each sub-app inventing its own state pattern, we decided for `@fairfox/polly` plus centralised data-action event delegation as the universal pattern, accepting the framework learning curve, to gain a single way of writing every fairfox interaction and TLA+-verified safety on the load-bearing parts.

## Considered alternatives

- **Per-sub-app choice — vanilla signals, custom WebSockets, ad-hoc fetch.** Rejected because it produces ten inconsistent state shapes and forces every cross-cutting concern to be re-implemented per sub-app.
- **Polly without TLA+ verification.** Rejected because it gives up Polly's most distinctive feature for a marginal simplification.
- **Polly with TLA+ as opt-in per sub-app.** Considered, but the user explicitly chose baseline verification because opt-in tends to mean "never adopted."

## Consequences

**Good:**
- One state pattern across every sub-app means moving between them is cognitively free.
- Real-time sync is essentially a config object on the Polly Elysia plugin, not custom WebSocket code.
- Action handlers are enumerable by grepping for `data-action=`, which is an audit superpower.
- TLA+ verification catches modal, form, and auth-state bugs before they ship.
- Stores own all writes; the UI is a pure reactive renderer with no hidden state.

**Bad:**
- Polly is the user's own framework; documentation lives in skill files and reading it is a real ramp-up cost.
- TLA+ verification as a baseline requirement adds CI time and demands handler authors think in preconditions and postconditions.
- The platform is now tightly coupled to Polly; replacing it later would touch every sub-app.
