# 0005 — Shared UI primitives in @fairfox/ui

**Status:** Accepted
**Date:** 2026-04-15

## Context and problem statement

Every fairfox sub-app needs the same set of UI building blocks: buttons, text inputs, selects, cards, layouts, modals. The current state has none of them as reusable components — each sub-app reinvents them with raw HTML and inline class names, and the result is three sub-apps that look and feel like three different products. The user wants one place where the platform's visual personality lives, and one specific primitive — rich text display with inline editing — that appears across many sub-apps and must work extremely well.

Getting that one primitive right is unusually high-leverage: it is the component users touch most often and the one whose feel most shapes how the platform reads.

## Decision drivers

- Every sub-app needs the same primitives, and reinventing them produces visual and behavioural inconsistency.
- A primitive that handles markdown display and inline editing well is a major leverage point because it appears in agenda, todo, library, and the new The Struggle.
- The user has experienced the lift Lingua's `@lingua/shared` provides and wants the same shape for fairfox.
- CSS modules with typed class names make typos and dead styles into compile errors rather than silent runtime drift.
- Every primitive must be designed around the data-action pattern from ADR 0002; retrofitting components to support it later is much harder than building them right initially.

## Decision

We will publish a `@fairfox/ui` package containing Button, Input, Select, Card, Layout, Modal, and a small handful of supporting primitives. CSS modules with `typed-css-modules` generate `.d.ts` files so that class references are type-checked at compile time. No primitive accepts an `onClick` prop; behaviour is wired via `data-action` attributes routed through the shared event-delegation layer described in ADR 0002.

The Input primitive has two variants — single-line, backed by `<input>`, and multi-line, backed by `<textarea>` with `field-sizing: content` for autosizing. In view mode it renders markdown via `marked` plus `DOMPurify` sanitisation. In edit mode it switches to the raw markdown source. Switching between modes produces no layout shift because the rendered element and the underlying input share font, padding, line-height, border, and width through the shared CSS module. There is no separate Textarea primitive: multi-line is `<Input variant="multi" />`.

Save policy is a per-use-site prop (`saveOn: 'blur' | 'explicit' | 'enter' | 'cmd-enter'`) because different fields want different policies. Saving dispatches a configured action through the global delegator; the sub-app's store handles the mutation. Optimistic UI is wired through the Polly mutation primitive: switch back to rendered mode immediately, run the mutation in the background, revert if it fails. Keyboard shortcuts in edit mode include Cmd/Ctrl+B, Cmd+I, Cmd+K, Cmd+Enter, and Escape.

The component library starts small — the seven or eight primitives listed above — and grows into `@fairfox/ui` as real needs appear in real sub-apps. New primitives never live inside individual sub-apps.

> In the context of building ten sub-apps that share visual and interaction patterns, facing the risk that each one reinvents buttons and inputs differently, we decided for a single `@fairfox/ui` package with a small set of primitives and a particularly well-built rich-text Input, against per-sub-app components or third-party design systems, to achieve a unified platform feel and a single point where visual personality lives.

## Considered alternatives

- **Per-sub-app components.** Rejected because it produces ten visual styles and ten subtly different interaction patterns.
- **A third-party design system (Radix, shadcn, Mantine).** Rejected because none of them know about data-action delegation, and the integration cost is comparable to writing the small set of primitives we actually need.
- **A larger initial component set, copied wholesale from Lingua's 41 primitives.** Rejected because most of those serve specific Lingua needs; the right shape is to start small and grow as needs appear.

## Consequences

**Good:**
- One source of truth for what a button or input looks like.
- Class name typos are compile errors, dead CSS is a compile error, and orphaned styles cannot accumulate.
- The rich-text Input pays back across every sub-app that displays or edits text content.
- New primitives grow into `@fairfox/ui` rather than into individual sub-apps, so the library only ever becomes more useful.
- Visual personality lives in one place and changing it changes every sub-app.

**Bad:**
- Bootstrapping the package is real up-front work before any sub-app benefits from it.
- The rich-text Input is genuinely hard to get right; getting it wrong is "quietly grating" — no layout shift, no keyboard surprises, no XSS, no autosizing glitches, all need to be solved together.
- Every primitive must be designed around `data-action` from the start, which means even simple components are slightly more involved to write.
