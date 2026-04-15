# 0003 — Authentication via seven hardcoded passphrases

**Status:** Accepted
**Date:** 2026-04-15

## Context and problem statement

Fairfox is private family infrastructure used by seven known people: Alex, Elisa, Leo, Vito, Ornella, Olly, and Trish. The user list is fixed and is not expected to grow. Every sub-app must require authentication, and there is no public-facing surface anywhere on the platform. The user prefers ProtonPass over 1Password as the human-facing source of truth for passphrases.

A traditional auth system (user table, hashing, registration flows, password reset, recovery email) would be pure overhead for this use case, and would bring its own surface for things to go wrong.

## Decision drivers

- The user list is fixed and small, so user-management features are wasted effort.
- Seven hardcoded passphrases are simpler to operate than any database-backed identity system.
- Every sub-app must require auth with no exceptions and no opt-out.
- Per-action attribution matters: the agenda fairness report needs to know which person marked a chore done.
- The user wants ProtonPass as the human-facing source of truth; no scripted CLI integration is required.

## Decision

We will identify users via seven hardcoded passphrases stored as Railway environment variables (`FAIRFOX_PASSPHRASE_ALEX`, `FAIRFOX_PASSPHRASE_ELISA`, and so on), mirrored in ProtonPass for the user's own reference. A single shared `/login` route in `packages/web` accepts a passphrase, performs constant-time comparison against every entry, and issues a long-lived signed JWT cookie containing only `{ name }`. The cookie is signed with `FAIRFOX_AUTH_SECRET` and scoped to the fairfox domain so signing in once works across every sub-app.

Every sub-app verifies the cookie via a shared `requireAuth` middleware exported from `@fairfox/shared`. There is no opt-out: the conformance test refuses to ship a sub-app whose route tree contains any unauthenticated handler other than `/login` and the static assets login itself needs.

An eighth reserved identity, `system`, exists for agent-initiated writes (cron jobs, the chat relay, family-phone agent actions). It has no passphrase and is unreachable via login. Sub-apps that care can distinguish human writes from agent writes — the agenda fairness report should ignore agent completions.

> In the context of a private family hub used by seven known people, facing the requirement that every sub-app must be authenticated and the user prefers operational simplicity, we decided for hardcoded passphrases in environment variables plus a stateless JWT cookie, against any database-backed identity system, to achieve a five-minute auth implementation with no user-management surface, accepting that rotation is manual and there is no recovery path other than the user editing the env var.

## Considered alternatives

- **Database-backed identity with hashing, sessions, and recovery flows.** Rejected as gross overkill for seven known people.
- **OAuth via Google or similar.** Rejected because it makes the family hub dependent on a third-party identity provider for a use case that needs none.
- **No auth, network-level access control only.** Rejected because the user wants per-action attribution and that requires identity at the request level.

## Consequences

**Good:**
- Implementation is roughly eighty lines of code total.
- Rotation is "edit Railway env var, redeploy" with no migration concerns.
- Auth state is stateless; nothing to back up, nothing to recover, nothing to corrupt.
- Per-action attribution comes for free since every authenticated request carries a name.
- The `system` identity lets agents act without polluting fairness reports or activity logs.
- Signing in once works across every sub-app, because the cookie is scoped to the platform domain.

**Bad:**
- Forgotten passphrases require AJT to read the value out of ProtonPass; there is no self-service recovery.
- A leaked passphrase requires AJT to rotate the env var manually; there is no per-device revocation.
- Adding an eighth person means a code change and a redeploy, not a UI flow.
- Brute-force protection is a single in-memory rate limiter with a five-second sleep on failed attempts; for seven hardcoded secrets this is sufficient, but it is the kind of corner that would need rethinking if the threat model ever changed.
