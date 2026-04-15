# T291 — Bootstrap @fairfox/ui

**Task:** T291 — Bootstrap @fairfox/ui package with event delegation, Button primitive, rich-text Input primitive, biome rules, and test harness.
**Project:** fairfox (P32)
**Branch:** `fairfox-P32-T291` (branched from `fairfox-P32-T276`, so it inherits all ADRs and the build-order plan)
**Working directory:** `~/projects/fairfox`

This document is the self-contained execution plan. A fresh Claude context should be able to pick it up cold: read this file end-to-end, read the ADRs it references, then start building. The architectural *why* lives in the ADRs; this document is the *what* and the *how*.

## Read these first

Before touching any code, read (in order):

1. **`docs/adr/README.md`** — the ADR index.
2. **`docs/adr/0001-fairfox-as-strict-platform-baseline.md`** — the umbrella decision that fairfox is a strict platform with a single baseline enforced uniformly. Explains why the UI package bans inline handlers and native interactive HTML.
3. **`docs/adr/0002-state-management-and-event-delegation-via-polly.md`** — the decision that every interaction goes through centralised event delegation via `data-action` attributes, routed into a per-sub-app action registry. This is why the UI primitives accept no `onClick`, `onChange`, `onSubmit`, or `onBlur` props.
4. **`docs/adr/0005-shared-ui-primitives-in-fairfox-ui.md`** — the decision specifically about `@fairfox/ui`, the primitive set, CSS modules with typed class names, and the rich-text Input design.
5. **`docs/plans/baseline-build-order.md`** — the build-order plan that T291 is the first item of.
6. **The polly skill** at `~/projects/.claude/skill-library/polly/skill.md` — for how `@fairfox/polly` is shaped and what `$resource` provides. Some of this may eventually change under the local-first RFC (https://github.com/AlexJeffcott/polly/issues/41), but T291 is intentionally state-model-independent and does not depend on Polly evolving.

Reference materials to adapt or read for ideas:

- **`~/projects/lingua/packages/web/src/providers/event-delegation.ts`** — the ~160-line pure-function event delegation module to port into `@fairfox/ui`. Zero lingua-specific coupling, essentially portable verbatim with light edits.
- **`~/projects/lingua/packages/shared/src/components/Button/Button.tsx`** — lingua's Button. The fairfox Button should follow a similar shape for discriminated variants but drop the deprecated `onClick` prop entirely.
- **`~/projects/lingua/packages/shared/src/components/Input/Input.tsx`** — lingua's Input. Useful for the view/edit machinery and the signal-binding pattern, but the fairfox Input is more ambitious (markdown rendering, no layout shift, data-action save).
- **`~/projects/lingua/.claude/skills/lingua/SKILL.md`** — the three-tier state architecture and data-action conventions from lingua.

## Repo state at the start of T291

The branch inherits from `fairfox-P32-T276`, which carries:

- `docs/adr/` — the six ADRs and the README.
- `docs/plans/baseline-build-order.md` — the build-order plan.
- Existing fairfox packages: `packages/shared` (SubApp contract, loadEnv, openDb), `packages/web` (Bun.serve host), `packages/todo` (legacy sub-app), `packages/struggle` (legacy sub-app).
- Two uncommitted files on `packages/todo/src/frontend/main.tsx` and `packages/todo/src/frontend/styles.css` — these are AJT's in-progress work. **Do not stage or commit them.** They travel along when switching branches; leave them alone.
- Root `biome.json`, `tsconfig.base.json`, `bunfig.toml`, `package.json` with workspaces.

## What T291 produces

A new `packages/ui` workspace package containing:

1. **Package bootstrap** — `package.json`, `tsconfig.json` extending `tsconfig.base.json`, a package-level `biome.json` if needed (probably not — extend the root).
2. **Event delegation module** — `packages/ui/src/event-delegation.ts`, adapted from lingua's file. Pure functions: `parseActionData`, `resolveAction`, `installEventDelegation`, plus the `ActionDispatch` type and `INTERACTIVE_TAGS` / `ACTION_EVENT_TYPES` sets. Unit-tested against the pure functions.
3. **Button primitive** — `packages/ui/src/components/Button/Button.tsx` plus `Button.module.css` and generated `Button.module.css.d.ts`. Discriminated variants (tier, color, size), icon slot, disabled, fullWidth, href-as-link variant. **No `onClick` prop.** Accepts `data-action`, `data-action-*`, and other passthrough HTML attributes. CSS module classes are all typed.
4. **Input primitive** — `packages/ui/src/components/Input/Input.tsx` plus `Input.module.css` and its `.d.ts`. Single-line and multi-line variants. View mode renders markdown via `marked` + `DOMPurify`. Edit mode shows raw markdown in `<input>` (single) or `<textarea>` (multi) with `field-sizing: content` for autosize. **No layout shift** between view and edit because rendered and input elements share font, padding, line-height, border, and width through the shared CSS module. Save policies via `saveOn` prop: `'blur' | 'explicit' | 'enter' | 'cmd-enter'`. Save dispatches a configured `data-action` with the new value through the global delegator. Optimistic view-mode swap on save with rollback on failure (see "The hard part" below). Keyboard shortcuts in edit mode: Cmd/Ctrl+B for bold, Cmd+I for italic, Cmd+K for link, Cmd+Enter to save, Escape to cancel. Empty-state placeholder.
5. **CSS modules setup** — `typed-css-modules` integration so every `.module.css` generates a `.d.ts` file. Wire this into the package build. TypeScript strict mode catches class name typos.
6. **Biome rules at the root** — bans `onClick`, `onChange`, `onSubmit`, `onBlur` props on components, bans raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<form>` in sub-app source, bans raw class name strings where a typed reference is expected. `packages/ui` is the only place where native interactive HTML is allowed (because that's where the primitives wrap it). Other sub-app packages are restricted. Biome's `noRestrictedSyntax`-like rules or a small custom check can cover this; if biome can't express all of it natively, a thin script run as part of `bun check` is fine.
7. **Test harness** — `bun test` for unit tests. `happy-dom` or similar for DOM tests if they're needed for the Input behaviour. Start simple; add a real browser harness only when unit tests can't cover the thing being tested.
8. **Exports** — `packages/ui/src/index.ts` exports `Button`, `Input`, the event-delegation functions, and any supporting types. Consumers import from `@fairfox/ui`.

## Constraints that cannot be negotiated

- **No `any`.** Strict TypeScript throughout. If you can't type something, find a way or ask.
- **No `as` casts except `as const`.** Use type guards.
- **No `@ts-ignore`, `@ts-expect-error`, or `.skip()` in tests.**
- **No `!` non-null assertions.**
- **No `onClick`, `onChange`, `onSubmit`, `onBlur` props on the UI primitives.** Event wiring is exclusively through `data-action`. This is the non-negotiable rule from ADR 0002.
- **No raw class name strings in component source.** Every class goes through the CSS module typed reference (`classes.foo`).
- **biome check and tsc must be green on every commit.**
- **Strict biome rules apply to `packages/ui` itself** — it's held to the same standard as any sub-app, even though it's the one place native interactive HTML is allowed.

## The hard part: optimistic save with rollback in the Input primitive

The Input primitive swaps to view mode optimistically when save fires. The actual save happens through the global delegator dispatching the configured `data-action`. The primitive does not own the mutation — that lives in whatever Polly store method handles the action. This creates a signalling problem: how does the primitive know if the save failed?

Options to consider during implementation:

1. **The handler signals back via a prop-supplied signal.** The primitive accepts a `saveStatus` signal from the parent; the parent's action handler sets it to `'ok'` or `'error'`. The primitive watches the signal and rolls back on `'error'`.
2. **The delegator returns a Promise.** `installEventDelegation` accepts an `onDispatch` that is async; the primitive awaits the dispatch and rolls back if it throws.
3. **A per-action event bus** where the primitive subscribes to `saveComplete:<action-name>` and rolls back if the event carries an error.

Option 2 is probably cleanest because it keeps the primitive's knowledge local. Option 1 is more explicit but forces every consumer to wire a signal. Decide during implementation; document the choice in a short code comment in `Input.tsx`.

Either way, the primitive's view-mode-swap is a *commit point* — after the swap, further edits are a new edit session, not a rollback of the attempted save.

## Order of work

Work in phases. Commit at the end of each phase with a classic-style message explaining the why, not the what. Never reference authors or contributors.

- **Phase A — package bootstrap.** Create `packages/ui` with `package.json`, `tsconfig.json`, a biome override if necessary, wire into the workspace, install dependencies (`preact`, `marked`, `dompurify`, `typed-css-modules`, `clsx`), set up the CSS-modules `.d.ts` generation. Add `bun check` and `bun typecheck` targets to the root that cover the new package.
- **Phase B — event delegation.** Port lingua's `event-delegation.ts` into `packages/ui/src/event-delegation.ts`. Write unit tests for `parseActionData` and `resolveAction` (both pure and easy to test). `installEventDelegation` is harder to unit-test without a DOM; defer that to a happy-dom test or cover it in the Button/Input integration tests.
- **Phase C — Button primitive.** Build the Button component with CSS modules, typed classes, discriminated variants, and passthrough for `data-action` and other HTML attributes. No `onClick`. Write unit tests for rendering under every variant combination and for data-action passthrough.
- **Phase D — Input primitive.** Build the Input component with both variants, view/edit toggle, markdown rendering + sanitisation, autosize, save policies, keyboard shortcuts, empty state, optimistic save with rollback. This is the longest phase. Write tests as you go; start with the simpler cases (single-line plain text, explicit save) and work up to the harder ones (multi-line markdown, cmd-enter save, XSS sanitisation, layout-shift check).
- **Phase E — biome rules.** Configure root biome to ban inline event handler props and raw native interactive HTML in sub-app source while allowing them inside `packages/ui`. If biome doesn't cover everything, add a small check script runnable via `bun check`. Verify by running `bun check` against the current state of the repo — it should flag the existing todo and struggle packages, which is fine (they're legacy and slated for deprecation per ADR 0006).
- **Phase F — verification.** Run `bun check`, `bun typecheck`, and `bun test`. All must pass clean for the `packages/ui` code itself. Legacy todo/struggle biome violations are expected and acceptable — the conformance test (built in a later task) will carry a skip list for those two packages.

## Done when

- `packages/ui` exists as a workspace package with the primitives listed above.
- `bun check` passes clean for `packages/ui` source and reports only expected legacy violations in `packages/todo` and `packages/struggle`.
- `bun typecheck` passes clean.
- `bun test` passes, covering the pure functions in event-delegation, Button rendering, and Input view/edit/save behaviour.
- The package exports are usable by importing from `@fairfox/ui` — a throwaway test file importing Button and Input compiles without errors.
- Each phase is committed separately with a classic-style commit message.
- The branch is pushed to origin.

## Out of scope for T291

These are real needs but belong to later tasks:

- **Card, Select, Modal, Layout** primitives. Add them in a follow-up when they're actually needed.
- **Action registry and provider.** The per-sub-app registry that maps action names to handler functions, and the root-mounted provider that wires the delegator to the registry. This belongs in the `packages/_template` task, not in `@fairfox/ui`.
- **Polly integration.** The Input's optimistic save dispatches through the delegator; how the handler then runs a Polly mutation is the consumer's problem, not the primitive's.
- **Real-world integration into a sub-app.** `@fairfox/ui` stands alone in T291; hooking it up to an actual sub-app happens in the `packages/_template` task.
- **Conformance test.** The CI check that every sub-app conforms to the baseline belongs in its own task. T291 just contributes the biome rules that the conformance test will lean on.
- **Revising ADR 0004.** The data-resilience ADR will be updated once the Polly local-first RFC matures. T291 doesn't touch it.

## How to resume from a clean context

From a fresh Claude session:

1. Start with `/todo T291`. The task skill reads the task from the API, loads project skills, `cd`s into `~/projects/fairfox`, and reads this plan.
2. Check out `fairfox-P32-T291` if not already on it.
3. Read the ADRs and the reference files listed at the top of this document.
4. Begin Phase A.

If the branch has diverged from `fairfox-P32-T276` (because T276 has landed on main in the meantime), rebase carefully — the ADR files should be identical, so rebase should be clean.
