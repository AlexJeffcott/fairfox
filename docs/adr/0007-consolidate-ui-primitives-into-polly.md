# 0007 — Consolidate UI primitives into @fairfox/polly/ui

**Status:** Accepted
**Date:** 2026-04-17

## Context and problem statement

ADR 0005 stood up `@fairfox/ui` as the single source of UI primitives for fairfox sub-apps. Polly later grew its own UI surface at `@fairfox/polly/ui`, shipped in v0.25.0, with the same design philosophy — `data-action` delegation, signal-backed state, CSS modules under `@layer polly-components`, token-driven colours. Both libraries converged independently on almost the same API; both were being maintained in parallel; both covered overlapping but not identical sets of primitives. Every fairfox sub-app therefore depended on two UI libraries whose existence was historical rather than architectural.

The cost of the split grew with every new primitive and every polly release: fairfox had to decide where a new component lived, and consumers carried duplicated dependency lines and two competing token sets (`--space-*` in fairfox, `--polly-space-*` in polly). Any visual refinement had to happen twice to stay consistent, and the primitives that only existed on one side (ActionForm, ConfirmDialog, OverlayRoot in polly; Badge, Button, Checkbox, Dropdown, Select, Skeleton, Tabs, Toggle in fairfox) made migration in either direction a real piece of work.

## Decision drivers

- Two libraries with the same design intent is the wrong resting state; one is the right resting state.
- Polly's UI primitives enforce a11y and layout rules (`polly quality css-layout`, minimum hit targets, focus-ring shape) via conventions the whole ecosystem can rely on; fairfox shouldn't run its own parallel versions of those conventions.
- Tokens are a design contract, not a naming preference. A single `--polly-*` token set is the point of consolidation — fairfox apps can still override variables for bespoke aesthetics, but the contract stays in polly.
- The markdown rendering that fairfox's Input wrapped internally is genuinely useful, but it shouldn't bloat polly's core bundle. Opt-in via a subpath gives consumers the choice.

## Decision

We fold `@fairfox/ui` into `@fairfox/polly/ui`. Polly 0.26.0 absorbs the nine primitives that only existed on the fairfox side — Badge, Button, Checkbox, Collapsible, Dropdown, Select, Skeleton, Tabs, Toggle — ports them 1:1 where the fairfox API was already considered, and collapses them onto polly's existing token and styling conventions. Polly's Layout gains an `inline` prop to host the icon-plus-label arrangement Button needs without violating the no-flex-or-grid-outside-Layout rule. Theme tokens the ported components genuinely need — `--polly-text-xs`, `--polly-radius-full`, `--polly-control-height-*`, `--polly-accent-hover`, contrast variants for success and warning, and the `--polly-status-*-{bg,text}` family — become first-class members of polly's theme, present in all four theme blocks (default `:root`, `prefers-color-scheme: dark`, and both explicit `[data-polly-theme]` overrides).

The Input primitive collides with polly's deliberate split between `TextInput` (passive form element) and `ActionInput` (view/edit with action dispatch on commit). Polly's split is the prior design and carries the day; `<ActionInput>` replaces fairfox's `<Input>` everywhere, and the markdown rendering becomes opt-in through a new subpath, `@fairfox/polly/ui/markdown`, whose `renderMarkdown` helper plugs straight into `ActionInput`'s existing `renderView` prop. `marked` and `dompurify` are declared optional peer dependencies on polly so the core `@fairfox/polly/ui` bundle stays zero-dep; consumers that use the markdown subpath install them themselves.

The event-delegation plumbing migrates the same way. Polly's `StoreProvider` plus `useStores()` supersedes fairfox's `DispatchContext`; fairfox's action-handler signature (`{data, event, element}`) is preserved so the existing action registries and the shared `pairingActions` keep working unchanged. Sub-apps drop the Provider wrapper and import `installEventDelegation` from `@fairfox/polly/actions`.

With every sub-app migrated, `@fairfox/ui` is deleted. The repo-level layout-ban script (`scripts/check-layout-ban.ts`) goes with it — the equivalent rule is enforced upstream by `polly quality css-layout`. The shared-components guard stays but points at `@fairfox/polly/ui` primitives and names `ActionInput`, `ActionForm`, and `Select` as the suggested replacements for raw HTML elements.

> In the context of running two UI libraries whose design intent was identical, facing the cost of duplicated maintenance and two parallel token systems, we decided to absorb `@fairfox/ui` into `@fairfox/polly/ui`, against keeping them split or forking either one further, to achieve a single home for UI primitives across every repo that depends on polly.

## Considered alternatives

- **Keep `@fairfox/ui` around as a fairfox-specific superset.** Rejected because the divergence wasn't doing useful work; every primitive in `@fairfox/ui` either duplicated a polly decision or could be ported upstream with no loss of generality. Keeping two libraries is the cost of indecision, not the reward for flexibility.
- **Ship a `fairfox-tokens.css` overlay inside polly.** Rejected on design intent. Polly's theming model is that consumers override `--polly-*` variables in their own cascade-later stylesheet; smuggling a consumer-named overlay into the library inverts that contract. Where a ported primitive genuinely needed a token polly lacked, the token is added to polly's own theme as a first-class `--polly-*` variable.
- **Add a `markdown` prop to `ActionInput` that wires marked + dompurify internally.** Rejected because it would add runtime dependencies to the core UI bundle for every consumer, whether they needed markdown rendering or not. The subpath keeps the cost opt-in.

## Consequences

**Good:**
- One UI library across polly-consuming projects. Primitives, tokens, a11y rules, and layout conventions converge.
- Fairfox sub-apps drop one workspace dependency each; the template is simpler; the surface new sub-apps start from is the published polly version.
- Visual personality can still be customised through `--polly-*` overrides in each consumer's own CSS — but the default now renders correctly without the consumer having to wire anything (fairfox apps never imported `tokens.css` before, which is the silent bug this migration fixes along the way).
- The markdown-rendering helper becomes a reusable polly feature rather than a fairfox-internal convention, so future polly consumers inherit it.

**Bad:**
- The Modal component is not ported; consumers that had used fairfox's monolithic Modal must rewrite call sites to polly's compound `Modal.Root / Modal.Backdrop / Modal.Content / …` API. No fairfox sub-app currently uses Modal, but the migration guide exists for the day one does.
- Polly's ActionInput has no `readonly` prop; fairfox's read-only markdown Inputs (the-struggle's passage body, library's ref and doc views) use `disabled={true}` instead. The semantics are close but not identical — `disabled` removes the control from the tab order entirely — and a `readonly` variant in polly is worth a future follow-up if the semantic difference surfaces as an issue.
