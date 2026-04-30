# Formal specifications

TLA+ specs for fairfox-specific protocols. Polly's own
[`MeshState.tla`](../node_modules/@fairfox/polly/dist/tools/verify/specs/tla/MeshState.tla)
ships with the package and verifies the mesh-transport layer
(signature soundness, revocation convergence, strong eventual
convergence). Specs here cover the application-level protocols
fairfox builds on top of that.

## Specs

- **`tla/LeaseHandoff.tla`** — chat relay leader-lease protocol
  (`packages/cli/src/commands/chat.ts`). Verifies that the
  `daemon:leader` lease has at most one live holder, that handoff
  to a surviving daemon eventually completes after the holder dies,
  and that under fairness the lease is eventually claimed when at
  least one daemon stays alive. This is the property the e2e
  leader-lease test was supposed to demonstrate but couldn't
  exercise reliably (the e2e harness hits a polly mesh-rediscovery
  edge case unrelated to the lease state machine itself).

## Running

Docker is required (the TLA+ toolchain runs in a container).

```sh
bun run tla:up          # build + start the container (one-off)
bun run tla:check       # run TLC against LeaseHandoff.tla
bun run tla:shell       # interactive shell, e.g. to run other specs
bun run tla:down        # tear down the container
```

A passing run prints `Model checking completed. No error has been
found.` and the size of the explored state graph. Failures print
the violated invariant or property plus the state trace that
reaches it.

## Adding a spec

1. Drop `Foo.tla` and `Foo.cfg` under `tla/`.
2. Add the spec name to this README.
3. Run it: `bun run tla:up && docker compose -f specs/docker-compose.yml
   exec -T tla tlc -workers auto Foo.tla`.

Add a `tla:check:foo` package script if it's worth running on every
PR; otherwise treat specs as design artefacts and run them on demand.
