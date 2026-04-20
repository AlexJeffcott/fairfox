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

`fairfox mesh init` is **the** canonical way to create a new mesh.
It's a deliberate, named action — there is no way to accidentally
start one by opening the wrong tab first.

```bash
fairfox mesh init \
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
4. Writes the admin's self-signed `UserEntry` into `mesh:users`
   and endorses this device on its `mesh:devices` row.
5. For each `--user <name>:<role>`: signs an invite blob (the
   invitee's fresh private key + role + display name, signed by
   the admin's key), writes the invitee's `UserEntry` into
   `mesh:users`, and stashes the blob in `~/.fairfox/invites.json`.
6. Prints the admin's recovery blob (save it — losing every
   device that holds the admin user key means losing the admin)
   and the list of pending invites with `mesh invite open`
   commands ready to copy-paste.

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
fairfox mesh invite list

# Live QR for an invite — holds the socket open until ctrl-c
fairfox mesh invite open elisa

# Re-emit for a user who's already paired one device (adds another
# device under the same identity)
fairfox mesh invite open elisa --reopen
```

`invite open` renders an ASCII QR in the terminal plus the full
share URL (`https://…/#pair=<tok>&s=<sid>&invite=<blob>`). The
invitee scans or clicks, their browser runs `consumePairingHash`,
imports the user key, endorses their device, and sends the
reciprocal pair-token back through the signalling relay. Your
terminal prints `✓ "Elisa" paired.` and stays open until ctrl-c.

If the signalling relay is unreachable, the invitee can still
fall back to the browser's manual-paste flow.

## After init: day-to-day commands

```bash
fairfox users                       # list every user in the mesh
fairfox users whoami                # this CLI's identity + perms
fairfox users invite <name> [--role admin|member|guest|llm]
fairfox users revoke <userId>
fairfox users export                # print the local recovery blob

fairfox peers                       # list every paired device
fairfox peers rename <name>
fairfox peers forget <peerId>

fairfox todo tasks                  # and the full todo surface
fairfox agenda list
fairfox deploy                      # railway up --detach

fairfox help                        # full command list
```

## Files the CLI writes

- `~/.fairfox/keyring.json` — device keypair + known peers + doc
  keys. Created on first pairing or `mesh init`.
- `~/.fairfox/user-identity.json` — user keypair (mode 0600).
  Created on `mesh init` or `users import <blob>`.
- `~/.fairfox/invites.json` — pending invite blobs (mode 0600).
  Created on `mesh init` / `users invite`; entries removed only
  by explicit cleanup or `mesh init --force`.

## Environment

- `FAIRFOX_URL` — override the default
  `https://fairfox-production-8273.up.railway.app` origin. The CLI
  derives its signalling URL (`wss://…/polly/signaling`) from
  this.
- `FAIRFOX_STRICT_MODE` — set to `1` / `true` to reject unsigned
  user rows and endorsements at read time. Default is lenient so
  existing paired devices keep working during migration.
