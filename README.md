# fairfox

A small household mesh. Every device you pair shares the same CRDT
state — todos, agenda, users, peers — over WebRTC; the server is
only there for discovery and a one-shot pairing relay, not the data
path. Browsers run as PWAs; the CLI is a peer too.

There are three ways to come at it:

- **I want to use fairfox.** Keep reading — the quick start below
  covers installing the CLI, starting a mesh, adding devices, and
  everyday commands.
- **I want to understand the architecture.** See
  [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the project overview
  and [`docs/plans/pairing-and-peer-management.md`](docs/plans/pairing-and-peer-management.md)
  for the design.
- **I want to help with the code.** `bun typecheck`, `bun check`,
  `bun test` should all stay green. Mesh-sync changes must pass
  `bun scripts/e2e-two-device-sync.ts` and
  `bun scripts/e2e-users-and-permissions.ts`.

## Quick start

### 1 · Install the CLI

From a checkout:

```sh
bash scripts/install-cli-local.sh
```

This builds the CLI, symlinks `dist/fairfox.js` to `~/.local/bin/fairfox`,
and drops a zsh completion at `~/.zfunc/_fairfox`. If `~/.local/bin`
isn't on your PATH yet, add this to `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
fpath=($HOME/.zfunc $fpath)
autoload -U compinit && compinit
```

Smoke test:

```sh
fairfox --help
```

### 2 · Start a new mesh

This creates the mesh, generates your admin identity, and prepares
invite QR codes for everyone else in the household:

```sh
fairfox mesh init \
  --admin "Alex" \
  --user "Elisa:member" \
  --user "Leo:member"
```

Output includes:

- **Recovery blob** for Alex — save this somewhere safe (password
  manager). Losing every device that holds your user key means
  losing admin access.
- **Mesh name + fingerprint.** The name is a line of poetry in the
  key of Dylan Thomas unless you pass `--name "…"`. The fingerprint
  is the first 8 hex of SHA-256 over the document key — two devices
  that claim to be on the same mesh must share it.
- **Pending invites** for Elisa and Leo, already admin-signed.

Roles: `admin`, `member`, `guest`, `llm`. Members can read/write
todos and agenda; guests default to read-only.

### 3 · Add your own second device (phone, laptop)

```sh
fairfox mesh add-device
```

Shows a terminal QR + share URL. Scan the QR on your phone — the
share URL carries a pair token and your recovery blob, so the phone
does everything in one tap: imports your identity, pairs with the
CLI, self-endorses. Ctrl-c closes the QR.

The URL carries your user secret key. Only share with yourself.

### 4 · Onboard another person

```sh
fairfox mesh invite open elisa
```

Holds a live QR open until ctrl-c. Elisa scans, her browser pairs +
adopts her identity in one scan. `fairfox mesh invite list` shows
pending/consumed invites across re-runs.

### 5 · Verify two devices are on the same mesh

```sh
fairfox mesh whoami
```

Prints this mesh's name + fingerprint + this device's peer id. Open
your laptop browser's home page and compare: the header shows the
same mesh name + fingerprint in parentheses. If they match, same
mesh. If not, one of the devices is on a different mesh and needs
re-initialising (or a fresh add-device scan).

## Everyday commands

```sh
# Todos (same data as the todo-v2 sub-app in the browser)
fairfox todo tasks                  # list open tasks
fairfox todo task add "Do the thing" --project P01 --priority high
fairfox todo task done T1776614638630-x33y
fairfox todo projects --status active

# Agenda
fairfox agenda list
fairfox agenda add "Take out the bins"

# Users (Users tab on the browser)
fairfox users                       # everyone
fairfox users whoami                # this CLI's identity + effective perms
fairfox users invite Leo --role member
fairfox users revoke <userId>

# Peers (Peers tab on the browser)
fairfox peers                       # every paired device
fairfox peers rename "Alex laptop"
fairfox peers forget <peerId>

# Deploy
fairfox deploy                      # railway up --detach from the repo root
```

## Moving between devices

The user identity is what makes you *you* across devices. It lives
at `~/.fairfox/user-identity.json` on the CLI and in IndexedDB in
the browser. The recovery blob (`fairfox-user-v1:…`) is the
portable form; keep it somewhere you can reach from any device.

- **New browser, same you:** the landing page shows "Who are you?"
  on a fresh browser. Paste the recovery blob into "Import recovery
  blob" to adopt your existing identity. Then pair that browser
  with an existing peer via `fairfox mesh add-device` or by
  clicking "Share a pairing link".
- **New CLI, same you:** `fairfox users import <blob>` loads the
  blob into `~/.fairfox/user-identity.json`. Still need to pair the
  device with `fairfox pair <token>` — the blob carries your
  identity, not this machine's entry into the mesh.
- **New mesh entirely:** `fairfox mesh init --force …`. That
  scorched-earth wipes this machine's local mesh state; other
  devices stay on the old mesh until they wipe theirs too.

## Files the CLI writes

- `~/.fairfox/keyring.json` — per-device Ed25519 keypair + known
  peers + mesh document key.
- `~/.fairfox/user-identity.json` — per-user Ed25519 keypair +
  display name. Mode 0600.
- `~/.fairfox/invites.json` — pending invite blobs the admin has
  issued but that haven't been consumed yet. Mode 0600.
- `~/.fairfox/mesh/` — this CLI's Automerge document store (todos,
  agenda, users, devices, meta). Safe to delete and re-sync from
  any other peer.

## Environment

- `FAIRFOX_URL` overrides the default origin
  (`https://fairfox-production-8273.up.railway.app`). The CLI
  derives its signalling URL (`wss://…/polly/signaling`) from it.
- `FAIRFOX_STRICT_MODE=1` tells every peer to reject unsigned
  `mesh:users` / `mesh:devices` rows at read time instead of
  logging a warning. Lenient is the default so existing devices
  can migrate; flip strict once everyone's on a fresh mesh.

## Troubleshooting

- **"This device isn't allowed to bring in new peers — ask an
  admin."** The browser has your user identity but hasn't received
  your `UserEntry` row yet from the mesh. Hard-reload the page
  (⇧⌘R); the self-heal in MeshGate writes a self-signed row
  locally. If that doesn't clear it, run `fairfox mesh add-device`
  and re-scan the QR.
- **CLI crashes with "Cycle detected" during `mesh init`.** That
  was a polly bug fixed in 0.29.3. Make sure `@fairfox/polly` in
  this repo's catalog is ≥ 0.29.3 and `bun install` has picked it
  up.
- **Browser doesn't show the install button.** Desktop Chrome
  needs a user-engagement signal (scroll/click/30s dwell) before
  it fires `beforeinstallprompt`. On Safari, install via the share
  menu → "Add to Dock" / "Add to Home Screen". Reloading the page
  helps too.
