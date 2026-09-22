# Fairfox

Fairfox is one app for one team. It is being rebuilt from scratch on the branch `rebuild`; `main` keeps the old app until step 0b. This tree is at step 0a, the wiring: a Bun workspace with six packages (`server`, `client`, `cli`, `shell`, `permissions`, `devctl`), and the tools of the step 0a table, each with one check, as they are added. No business logic and no routes yet. `turn/` is the relay, `fairfox-turn` on Fly; it is not part of the workspace.

What to build, in what order, and why: `~/projects/home-projects/requirements.md`. Read it before you change anything. That directory is read-only from here.

Run `bun devctl --help` from the root of the checkout to see what you can do. Every development task is a `devctl` command. A bare `devctl` in a shell may be lingua's: `~/.zshrc` sources lingua's wrapper, which runs `~/projects/lingua`'s devctl outside a lingua checkout. `bun devctl` always runs this checkout's.

- `devctl ci` runs every registered check on the commit that is checked out. A new check is one entry in `packages/devctl/src/checks.ts`, with the change that made it red recorded beside it (M3). See it red with `devctl ci --red --only <name>`.
- No `as` casts and no fixed waits.
- Config fails loud, with no fallback values (C1). Tests take config as arguments and never read `.env` or `process.env` (C2).
