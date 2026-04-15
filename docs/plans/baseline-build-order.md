# Fairfox baseline — build order

This is the sequence that turns the decisions in [`../adr/`](../adr/) into running code. It assumes the ADRs have been read; the reasoning behind the choices lives there, and this document only captures the order of work and what each phase produces.

The order is chosen so that no phase depends on a later phase, every new sub-app proves something about the baseline, and the riskiest migration (todo) happens against a baseline that has already carried two real sub-apps.

## Phase 1 — Baseline foundations

The shared infrastructure that every sub-app will depend on. Nothing in this phase is user-visible; all of it is platform.

1. **`@fairfox/ui` foundation.**
   - Set up `typed-css-modules` so every `.module.css` gets a generated `.d.ts`.
   - Port the event-delegation core from Lingua's `packages/web/src/providers/event-delegation.ts` into `@fairfox/ui/event-delegation`. Pure functions, no Lingua-specific coupling.
   - Define the action registry shape: a typed `Record<string, async ({ stores, data, event }) => void>` with the same signature as Lingua.
   - Write the first primitives: Button, Input (single + multi variants with markdown view/edit, autosize, optimistic save through Polly), Select, Card, Layout, Modal.
   - Configure biome rules that ban `onClick`, `onChange`, `onSubmit`, `onBlur` props on any component, ban native interactive HTML elements (`<button>`, `<input>`, `<select>`, `<textarea>`) in sub-app source, and ban raw class name strings.

2. **`@fairfox/shared` additions.**
   - Backup registration API: `registerBackup({ db, name })`. Walks registered databases at backup time.
   - Hourly-cadence backup runner that runs at 06:00 and 18:00 local time, dumps each registered database to JSON (schema + data), commits to the backup repo, and pushes.
   - Diff guardrail: refuse to push if any sub-app's dump shrinks by more than 20%, alert via healthchecks.io instead.
   - Migrations runner: `migrate(db, './migrations')` with `NNNN_name.sql` files. Calls `forceBackup()` and tags the commit `pre-migration-<sub-app>-<version>` before applying any up-migration. Auto-deletion on schema mismatch is forbidden by code.
   - `restore --check` command: clones the backup repo fresh, picks the latest dumps, rebuilds throwaway databases, runs sanity queries, reports.
   - Auth adapter: load the seven `FAIRFOX_PASSPHRASE_*` env vars, constant-time compare on `/login`, issue a long-lived signed JWT cookie, expose `requireAuth` middleware, reserve `system` as the eighth identity.
   - Logging shape: Pino with the sub-app name baked into the base context.

3. **Polly Elysia plugin conventions.**
   - Document the standard `polly()` plugin config shape that every sub-app uses: state declarations, effects with `broadcast: true` on routes that need real-time, offline support config for sub-apps that need it.
   - The `_template` sub-app will demonstrate this concretely.

4. **`packages/_template`.**
   - A working sub-app skeleton that is the only blessed way to start a new sub-app.
   - Includes: Polly plugin mounted, action registry skeleton, store provider, one Input field bound to a store-managed signal, one action handler that dispatches a Polly mutation, one TLA+-verified modal lifecycle, `requireAuth` wired on every route, `registerBackup` called at boot, one passing unit test, one passing browser test.
   - The template is the reference implementation of the baseline. Anything that can be done in the template should be done there, not duplicated into each new sub-app.

5. **Conformance test.**
   - Walks `packages/*` and checks every sub-app conforms.
   - Checks (each is independent and clearly named): exports a `SubApp` with a mount literal, exports the Elysia app type for Eden, has a `migrations/` directory, has no raw `<button>/<input>/<select>/<textarea>/<form>` in frontend source, has no `onClick`/`onChange`/`onSubmit`/`onBlur` props on any component, calls `registerBackup` at boot, has every route authenticated except `/login`, has every declared `data-action` corresponding to a registered handler, passes `polly verify` on its declared verification config, biome passes with no per-package overrides.
   - Carries an explicit skip list for `packages/struggle` and `packages/todo`. The skip list is part of the test itself, not a per-package opt-out, so removing a sub-app from the skip list is a deliberate one-line change.

6. **Backup repo bootstrap.**
   - Create `AlexJeffcott/fairfox-backups` as a private GitHub repo.
   - Wire its deploy key into the fairfox Railway service.
   - Run the first backup manually to confirm the chain works end to end.

## Phase 2 — The proving grounds: new The Struggle and library

Two real sub-apps built fresh on the baseline. Together they cover varied application shapes (read-heavy narrative rendering, structured CRUD over typed entities) and prove the baseline holds.

7. **`packages/the-struggle`.**
   - New sub-app, copied from `_template`, mounted at `/the-struggle`.
   - Game engine ported from `packages/struggle/src/engine.ts`, restructured around Polly stores and `data-action` event delegation.
   - Reader frontend rebuilt using `@fairfox/ui` primitives. The Input rich-text component handles passage editing.
   - Schema: chapters, passages, passage_content, choices, litanies, place_names, rewrites, feedback. Migrations runner handles them.
   - `registerBackup` called at boot.

8. **`packages/library`.**
   - New sub-app, copied from `_template`, mounted at `/library`.
   - Refs CRUD over the `refs` table.
   - Docs browser over the `world/`, `structure/`, `interface/` markdown directories.
   - Frontend rebuilt using `@fairfox/ui`. Markdown rendering and inline editing through the rich-text Input.
   - `registerBackup` called at boot.

9. **Content migration from `packages/struggle` to `the-struggle` and `library`.**
   - Triggered manually with backup-first safety: dump current struggle DB, tag the commit, then run a migration script that splits the data into the two new schemas.
   - Diff-check the result against the original. Only flip the sub-app routes once the diff looks right.
   - Retire `packages/struggle` once the new sub-apps are live and have served traffic without issue for at least a week.

## Phase 3 — Migrate todo

The largest single migration, against a baseline that has now carried two real sub-apps and revealed any rough edges.

10. **`packages/todo-v2`** (final name TBD; could just become `todo` once the old one is retired).
    - New sub-app, copied from `_template`, mounted at `/todo`.
    - All current todo features rebuilt: project tracker, task lists, agenda, fairness report, chat tab, quick capture.
    - The 72 inline-handler buttons in the current frontend are replaced with `data-action`-driven primitives.
    - Polly stores hold all state; mutations go through store methods; the Elysia plugin handles real-time sync for the chat tab and agenda updates.
    - Schema migrated from old todo. The `/api/backup` endpoint shape stays compatible so any existing scripts keep working.

11. **Content migration from old todo to new.**
    - Same backup-first pattern as Phase 2.
    - Retire `packages/todo` once the new one is live.

12. **Template refinement.**
    - With three real sub-apps now living on the baseline, pull any repeated setup or pattern out of them and into the template.
    - Update the conformance test if any new pattern needs enforcement.

## Phase 4 — Greenfield sub-apps

Once the baseline has carried three migrations cleanly, new sub-apps are pure copy-from-template work. The order is driven by user need rather than platform need.

Likely candidates from the current TODO list:
- **`agenda`** as its own sub-app (currently embedded in todo) if the household agenda outgrows the todo tab.
- **`speakwell`** — the spoken-skills coach.
- **`family-phone`** PWAs — directory, admin, handset.
- **`chat`** — the relay-driven chat surface, currently embedded in todo, possibly extracted.

Each one is a `cp -r packages/_template packages/<name>` followed by feature work. The platform decisions are already made.

## Open items

- **`packages/web` audit.** The static landing page needs `requireAuth` wired in and needs to use `@fairfox/ui` for the sub-app list. Likely done as part of Phase 1.
- **Annual backup repo roll.** Decide the exact January-rollover script.
- **Polly verification in CI timing.** TLA+ runs are non-trivial; test how long the full conformance check takes on Railway and budget accordingly.
- **`@fairfox/polly` documentation.** The framework is well-developed but its docs live in skill files. Consider extracting them into the polly repo itself as the platform grows.
