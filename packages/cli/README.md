# fairfox CLI

The command-line peer for the fairfox mesh. Shares the same
keyring, signalling relay, and CRDT documents the browser and
extension do, so anything you can see or write from a browser you
can also see or write from a terminal.

Built to be a first-class mesh citizen: it pairs like a browser,
holds its own Ed25519 identity, and participates in every
`$meshState` document (todo, agenda, users, devices). One binary,
one pairing, one source of truth.

## Starting a new mesh

`fairfox init <mesh-name>` is **the** canonical way to create a
new mesh. It's a deliberate, named action — there is no way to
accidentally start one by opening the wrong tab first.

```bash
fairfox init "Holm household" \
  --admin "Alex" \
  --user "Elisa:member" \
  --user "Leo:guest" \
  [--force]
```

What this does:

1. If `~/.fairfox/keyring.json` or `~/.fairfox/user-identity.json`
   already exist it refuses, unless `--force` is passed. `--force`
   wipes both plus any pending invites — **local only**. Other
   paired devices stay on the old mesh until they wipe their own
   state.
2. Generates a fresh device keypair → `~/.fairfox/keyring.json`.
3. Generates a fresh admin user keypair → `~/.fairfox/user-identity.json`
   (chmod 0600).
4. For each `--user <name>:<role>`: signs an invite blob (the
   invitee's fresh private key + role + display name, signed by
   the admin's key) and stashes it in `~/.fairfox/invites.json`.
5. Prints the admin's recovery blob (save it — losing every
   device that holds the admin user key means losing the admin)
   and the list of pending invites with `add user` commands ready
   to copy-paste.

The admin's signed `UserEntry` and the invitees' pre-signed rows
land in `mesh:users` at init time. The admin's own CLI also
endorses itself on its `mesh:devices` row so `canDo('user.*')`
returns admin permissions immediately (useful if you skip
straight to `fairfox add user <name>` without opening a browser).

(Earlier releases deferred these writes to the first browser
open because polly's `$meshState` hit a preact-signals "Cycle
detected" on bun. Fixed in polly by guarding `applyTopLevel`
against value-equal writes; requires `@fairfox/polly@0.29.3+`.)

Roles: `admin`, `member`, `guest`, `llm`. See
`packages/shared/src/policy.ts` for the role → permission table.

## Onboarding invited users

Each invite lives in two pieces with different lifetimes:

- **Blob (admin-signed user key + role)** — persists in
  `~/.fairfox/invites.json`. Stable across re-opens.
- **Pair-token + signalling session id** — ephemeral. Born when
  you run `invite open`, dies when you close the QR.

This matches the physical affordance: *the invite is live while
the QR is on screen; closed when you put it away; reopen any time
to re-emit a fresh QR for the same person.*

```bash
# List pending and consumed invites
fairfox invites

# Live QR for an invite — mints if missing, otherwise reopens.
# Holds the socket open until ctrl-c.
fairfox add user elisa --role member

# Mint and queue without holding the socket open.
fairfox add user elisa --role member --queue-only
```

`add user` renders an ASCII QR in the terminal plus the full
share URL (`https://…/#pair=<tok>&s=<sid>&invite=<blob>`). The
invitee scans or clicks, their browser runs `consumePairingHash`,
imports the user key, endorses their device, and sends the
reciprocal pair-token back through the signalling relay. Your
terminal prints `✓ "Elisa" paired.` and stays open until ctrl-c.

If the signalling relay is unreachable, the invitee can still
fall back to the browser's manual-paste flow.

## Adding another device for yourself

The `--user` flags on `init` and `fairfox add user` are for
bringing *other people* into the mesh. Adding your phone, a second
laptop, or any new device for your own user identity is a different
verb:

```bash
fairfox add device
```

This emits a terminal QR + share URL that carries
`#pair=<tok>&s=<sid>&recovery=<your-recovery-blob>`. Scanning it
on the new device's browser:

1. Applies the pair token (the new device now trusts this CLI).
2. Imports the recovery blob (the new device adopts *your* user
   identity — same `userId`, same role, same grants).
3. Self-endorses the new device on its `mesh:devices` row.
4. Sends the reciprocal pair-token back so this CLI trusts the
   new device too.

The URL carries your user secret key — treat it like a password
and only send it over channels you control (your own phone, a
private message, etc.). The session closes when you ctrl-c out
of the command; reopening generates a fresh pair-token but
reuses the same recovery blob.

## After init: day-to-day commands

```bash
# Identity / membership
fairfox whoami                       # this CLI's identity + perms
fairfox users                        # list every user in the mesh
fairfox add user <name> [--role …]   # invite (mints + opens QR)
fairfox revoke <userId>              # admin-signed user revocation
fairfox pair <token-or-url-or-blob>  # receive any onboarding payload

# Devices
fairfox peers                        # every paired device
fairfox rename <name>                # rename this device
fairfox forget <peerId>              # local: stop syncing with a peer
fairfox fingerprint                  # 8-hex mesh fingerprint

# Sub-apps and lifecycle
fairfox todo tasks                   # and the full todo surface
fairfox agenda list
fairfox doctor                       # storage-only diagnosis
fairfox deploy                       # railway up --detach
fairfox update                       # fetch the latest CLI bundle

fairfox --help                       # full command list
fairfox <command> --help             # per-command help
fairfox <command> --verbose          # debug output to stderr
```

## Files the CLI writes

- `~/.fairfox/keyring.json` — device keypair + known peers + doc
  keys. Created on first pairing or `init`.
- `~/.fairfox/user-identity.json` — user keypair (mode 0600).
  Created on `init` or `pair <recovery-blob>`.
- `~/.fairfox/invites.json` — pending invite blobs (mode 0600).
  Created on `init` / `add user`; entries removed only by explicit
  cleanup or `init <name> --force`.

## Environment

- `FAIRFOX_URL` — override the default
  `https://fairfox-production-8273.up.railway.app` origin. The CLI
  derives its signalling URL (`wss://…/polly/signaling`) from
  this.
- `FAIRFOX_STRICT_MODE` — set to `1` / `true` to reject unsigned
  user rows and endorsements at read time. Default is lenient so
  existing paired devices keep working during migration.
