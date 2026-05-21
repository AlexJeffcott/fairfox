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
   and the list of pending invites with `pair open --user`
   commands ready to copy-paste.

The admin's signed `UserEntry` and the invitees' pre-signed rows
land in `mesh:users` at init time. The admin's own CLI also
endorses itself on its `mesh:devices` row so `canDo('user.*')`
returns admin permissions immediately (useful if you skip
straight to `fairfox pair open --user <name>` without opening a
browser).

(Earlier releases deferred these writes to the first browser
open because polly's `$meshState` hit a preact-signals "Cycle
detected" on bun. Fixed in polly by guarding `applyTopLevel`
against value-equal writes; requires `@fairfox/polly@0.29.3+`.)

Roles: `admin`, `member`, `guest`, `llm`. See
`packages/shared/src/policy.ts` for the role → permission table.

## Bringing devices and people onto the mesh

`fairfox pair open` is the one verb for it. From a device already
on the mesh:

```bash
# Add another of YOUR devices (phone, second laptop). Shows a join
# QR and holds the socket open until ctrl-c.
fairfox pair open

# Invite a new person with a role. Mints the invite if missing,
# otherwise reopens it.
fairfox pair open --user "Elisa:member"

# Mint and queue an invite without showing the QR.
fairfox pair open --user "Leo:guest" --queue-only

# Reopen a QR for someone who already has a paired device.
fairfox pair open --user "Elisa:member" --reopen

# List pending and consumed invites.
fairfox pair list
```

The QR carries **transport only** — a pair token, a session id,
and one ephemeral key `k` (`https://…/#pair=<tok>&s=<sid>&k=<key>`).
It is small enough for a phone or tablet camera to resolve.

The identity the new device adopts — your recovery blob for "add
my own device", or the invitee's admin-signed invite blob for
`--user` — is **never on the QR**. The issuer encrypts it under `k`
and hands the ciphertext to the new device over the relay's
pair-ack frame once the handshake completes. The relay forwards
ciphertext it cannot read; `k` lives only on the QR, which is
scanned camera-to-camera. `k` is ephemeral — born when the QR
opens, gone when it closes — so it is a transient join credential,
not a permanent secret.

Each invite still lives in two pieces with different lifetimes:
the **admin-signed blob** persists in `~/.fairfox/invites.json`
and is stable across reopens; the **pair token + session id + ack
key** are ephemeral, born when the QR opens and dead when it
closes.

If the signalling relay is unreachable the encrypted hand-off
cannot run; `pair open` then prints the identity blob so you can
transfer it by hand as a last resort.

The receiving side is the join QR's scan target, or
`fairfox pair join <url>` on another CLI.

## After init: day-to-day commands

```bash
# Identity / membership
fairfox whoami                       # this CLI's identity + perms
fairfox users                        # list every user in the mesh
fairfox pair open [--user "N:role"]  # show a join QR (device or person)
fairfox pair join <url-or-token>     # join a mesh someone opened
fairfox pair list                    # pending + consumed invites
fairfox revoke <userId>              # admin-signed user revocation

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
  Created on `init`, `pair join`, or a recovery-blob import.
- `~/.fairfox/invites.json` — pending invite blobs (mode 0600).
  Created on `init` / `pair open --user`; entries removed only by
  explicit cleanup or `init <name> --force`.

## Environment

- `FAIRFOX_URL` — override the default
  `https://fairfox-production-8273.up.railway.app` origin. The CLI
  derives its signalling URL (`wss://…/polly/signaling`) from
  this.
- `FAIRFOX_STRICT_MODE` — set to `1` / `true` to reject unsigned
  user rows and endorsements at read time. Default is lenient so
  existing paired devices keep working during migration.
