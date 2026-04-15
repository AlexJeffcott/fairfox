# Architecture Decision Records

Decisions that shape fairfox as a platform. Each ADR captures one decision in MADR format. New decisions get the next number; superseded decisions are marked but not deleted.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-fairfox-as-strict-platform-baseline.md) | Fairfox as a strict platform baseline | Accepted |
| [0002](0002-state-management-and-event-delegation-via-polly.md) | State management and event delegation via @fairfox/polly | Accepted |
| [0003](0003-authentication-via-seven-hardcoded-passphrases.md) | Authentication via seven hardcoded passphrases | Accepted |
| [0004](0004-data-resilience-via-twice-daily-json-dumps.md) | Data resilience via twice-daily JSON dumps to GitHub | Accepted |
| [0005](0005-shared-ui-primitives-in-fairfox-ui.md) | Shared UI primitives in @fairfox/ui | Accepted |
| [0006](0006-deprecate-and-rebuild-migration-approach.md) | Deprecate-and-rebuild migration for existing sub-apps | Accepted |

The build sequence that turns these decisions into running code lives at [../plans/baseline-build-order.md](../plans/baseline-build-order.md).
