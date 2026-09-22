# Fairfox

Fairfox is one app for one team. It is being rebuilt from scratch on the branch `rebuild`; `main` keeps the old app until step 0b. This tree is at step 0a, the wiring: a Bun workspace with six packages (`server`, `client`, `cli`, `shell`, `permissions`, `devctl`), the tools, and one check for each. No business logic and no routes yet. `turn/` is the relay, `fairfox-turn` on Fly; it is not part of the workspace.

What to build, in what order, and why: `~/projects/home-projects/requirements.md`. Read it before you change anything. That directory is read-only from here.

Run `devctl --help` to see what you can do. Outside zsh, run `bun devctl --help` from the root of the checkout. For the zsh wrapper and completion, source `completions/devctl.zsh`. Every development task is a `devctl` command.

- `devctl ci` runs every registered check on the commit that is checked out. A new check is one entry in `packages/devctl/src/checks.ts`, with the change that made it red recorded beside it (M3). See it red with `devctl ci --red --only <name>`.
- No `as` casts and no fixed waits.
- Config fails loud, with no fallback values (C1). Tests take config as arguments and never read `.env` or `process.env` (C2).
