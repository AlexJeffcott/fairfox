# Architecture Decision Records

Decisions that shape fairfox as a platform. Each ADR captures one decision in MADR format. New decisions get the next number; superseded decisions are marked but not deleted.

| # | Title | Status |
|---|-------|--------|
| [0001](0001-fairfox-as-strict-platform-baseline.md) | Fairfox as a strict platform baseline | Accepted (revised 2026-04-16) |
| [0002](0002-state-management-and-event-delegation-via-polly.md) | State management and event delegation via @fairfox/polly | Accepted (revised 2026-04-16) |
| [0003](0003-authentication-via-device-keypairs.md) | Authentication via Ed25519 device key pairs | Accepted (revised 2026-04-16) |
| [0004](0004-data-resilience-via-mesh-replication.md) | Data resilience via mesh replication | Accepted (revised 2026-04-16) |
| [0005](0005-shared-ui-primitives-in-fairfox-ui.md) | Shared UI primitives in @fairfox/ui | Superseded by 0007 |
| [0006](0006-deprecate-and-rebuild-migration-approach.md) | Deprecate-and-rebuild migration for existing sub-apps | Accepted (revised 2026-04-16) |
| [0007](0007-consolidate-ui-primitives-into-polly.md) | Consolidate UI primitives into @fairfox/polly/ui | Accepted |

The build sequence that turns these decisions into running code lives at [../plans/baseline-build-order.md](../plans/baseline-build-order.md).
