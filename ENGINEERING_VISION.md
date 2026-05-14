# Engineering vision

How fairfox is built, expressed as mechanisms that fulfil the
behaviours in [`PRODUCT_VISION.md`](PRODUCT_VISION.md). If a sentence
here cannot be traced back to a product behaviour, it has drifted and
should be cut.

## Principles

- **Architecture is the durability story.** Every paired device
  holds a full encrypted Automerge replica of every sub-app's data.
  Resilience is a property of the topology, not a backup cron. See
  [`docs/adr/0004-data-resilience-via-mesh-replication.md`](docs/adr/0004-data-resilience-via-mesh-replication.md).
- **The transport is dumb.** Anything in the data path between two
  devices — discovery server, TURN relay, signalling socket — sees
  ciphertext only and stores nothing across reconnects.
- **Identity is cryptographic.** Users and devices are keypairs;
  permissions are signed entries the writer produces. "The system
  enforces that" in product terms means "the keys make it
  mathematically true" in engineering terms.
- **The CLI is a peer, not a client.** Every read and write the
  browser can do, the CLI can do, against the same `$meshState`
  documents over the same WebRTC transport. No shadow API.
- **Plain-text egress is a property of the data, not a feature.**
  Every document exports to JSON the user can open in their text
  editor without us.

## Behaviour to mechanism

Each row: the mechanism the architecture provides, and how far that
mechanism is verified against the deployed Fly stack today.

| Product behaviour | Engineering mechanism | Verified end-to-end? |
|---|---|---|
| Five-minute-old edit shows up without a refresh button | Automerge incremental sync over WebRTC; mesh re-establishes on tab focus and network change | Yes — `e2e-fly-turn-relay.ts` pairs a fresh browser with a fresh CLI and the CLI heartbeat reports `peers=1` through the data channel |
| Phone on the train, laptop at home, same identity | User key replicated to every device the user pairs in; documents replicate independently of which device wrote them | Partial — pairing + slot establishment verified; cross-network movement of the same identity not specifically exercised |
| "For me only" / "for me and people I name" | Per-document encryption with per-user keys held in polly's keyring; the discovery operator never holds a user key | Yes, architecturally (cryptographic) |
| One-ceremony setup, no server-config quest | `fairfox mesh init` generates the admin keyring + signs the genesis `mesh:users` document locally; no remote step in the critical path | Yes — CLI path |
| Invite at the same moment as setup | Admin-signed invite blobs land alongside the admin's own keyring during init; sharing is a QR + URL, not a multi-step provisioning | Yes — CLI path |
| Walk away with everything you've written | `fairfox export` writes each `$meshState` document to JSON, all of it machine-readable plain text | Plumbed; not exercised this session |
| Read and write everything from a terminal | `packages/cli` and `packages/home` consume the same action registry from `packages/shared`; new handlers live there, not behind HTTP routes | Partial — CLI `$meshState` pipeline passes `e2e-chat-relay.ts` |
| Keeps working offline, catches up automatically | Automerge's incremental sync converges on reconnect; local-only writes go to IndexedDB or the filesystem immediately | Offline writes verified; the convergence side is implied by the verified browser↔CLI sync but not exercised under a deliberate offline-then-reconnect script yet |
| Unreadable by the discovery operator | Mesh-state encryption with per-user keys not held by the relay; the relay routes opaque payloads | Yes, architecturally |
| Abandon a household without residue | `Reset` button in the SPA clears IndexedDB + reloads; CLI removes `~/.fairfox/` | Plumbed; the "IndexedDB hung" failure mode this session needs a separate "clear local mesh" recovery action surfaced behind a confirm |
| No new server, no new database, no new cloud account | No persistent server-side state. The only server-side processes are a static SPA host and a stateless signalling relay, both ciphertext-only. The user does not deploy either; they consume a community-hosted endpoint or self-host on hardware they already own | Yes |

## Where the server lives

The product vision permits exactly one server-side concession:
something has to introduce two devices to each other. Once they have
introduced themselves, the conversation is direct over WebRTC. The
server cannot see plaintext, does not persist state across
reconnects, and is fungible — any signalling relay implementing the
same protocol can be swapped in by changing the URL each device
points at.

Three placement options, in order of self-containment:

1. **LAN only, on a single machine.** The CLI and the laptop browser
   pointed at `http://localhost` both work in full. Other devices
   on the LAN cannot join without TLS on the host endpoint, because
   browsers reserve crypto and Service Workers for Secure Contexts
   and `192.168.x.x` does not qualify. A self-signed cert the family
   installs once, or an overlay that issues real certs for a private
   domain, lifts this constraint. See [The localhost path,
   honestly](#the-localhost-path-honestly) below.
2. **One of your own devices is the relay.** A long-running
   `fairfox node` process on the household's always-on machine — a
   spare laptop, a Pi, the desktop you leave on — exposes signalling
   on a port the family's other devices reach. Same TLS requirement
   for the SPA endpoint applies. No third party, no account, the
   same binary that runs the CLI.
3. **A shared community relay serves the SPA over HTTPS.** A static
   SPA plus a stateless WebSocket. Anyone can host one; fairfox
   ships a default URL but every device can be reconfigured. The
   host sees ciphertext only and stores nothing across reconnects,
   so the trust required is operational (it stays up) rather than
   data-privileged. This is what fairfox-production is today.

These are not exclusive. A device can try a list of relays in order.
The current production deployment is option 3 (fairfox-production on
Fly); the engineering arc is to make options 1 and 2 default-easy so
the shared relay is a convenience, not a dependency.

## The localhost path, honestly

A fresh user runs `fairfox mesh init --admin "Name"` and gets, on
their own machine and without contacting any network:

- A device keyring (`~/.fairfox/keyring.json`)
- An admin user key
- A pending-invites file for each `--user` named on the command line
- A signed `mesh:users` document in the local Automerge repo

They then run `fairfox`, which starts a single `Bun.serve` on a
localhost port. That process serves the SPA on `/`, mounts the
signalling WebSocket on `/polly/signaling`, and holds the same
`$meshState` documents the CLI just created. The laptop's own
browser pointed at `http://localhost:3000` works in full, including
the keyring crypto, because browsers treat `localhost` as a Secure
Context.

That Secure-Context gift does not extend to other devices reaching
the same machine. A phone on the same wifi can route packets to
`http://192.168.1.42:3000`, but the browser there will refuse to
expose `crypto.subtle`, will not register a Service Worker, and will
silently reduce IndexedDB quota. Without `crypto.subtle` fairfox
cannot unlock the keyring at all. So "localhost pairing" on its own
delivers the laptop browser and the CLI on the same machine. It
does not deliver the phone.

Three honest options for the phone:

1. **TLS on the household-side endpoint.** A self-signed cert the
   phone has been taught to trust, or a Tailscale-style overlay that
   issues real certs for a private domain. Solves the Secure-Context
   problem; the second option requires a third-party account, the
   first requires a one-time install ceremony.
2. **Serve the SPA from any HTTPS origin both devices reach.** A
   static SPA plus a stateless WebSocket signalling endpoint, hosted
   anywhere with TLS — Cloudflare Pages, GitHub Pages, a small Fly
   app, an old domain on a Pi. The host sees ciphertext only and
   stores nothing across reconnects, so it is operationally a
   community service rather than a trusted server. This is what
   fairfox-production is today.
3. **A native iOS/Android wrapper.** The SPA ships inside a WebView
   loaded from a bundled origin, which is a Secure Context. Real
   work, real app-store ceremony, but it removes any third party
   from the SPA delivery path for phones.

Option 2 is the smallest by a wide margin: a static SPA plus a
stateless WebSocket, hosted on any free-tier origin, with the
guarantee that nothing privileged lives there.

## The cert-install ceremony

If the household chooses option 1 or 2 — keeping the SPA host on a
device they own — every phone, tablet and laptop on the LAN reaches
that host over HTTPS, and the browsers there only treat it as a
Secure Context if the cert is trusted. The fence is browser policy,
not configurable: clicking through a cert warning is not enough.
Chrome and Safari downgrade an origin reached through a bypassed
warning and will not register Service Workers against it. Three
pieces have to be true:

- **The cert's SAN covers what the phone reaches.** Not `localhost`,
  because each phone resolves that to itself. An IP SAN for the
  host's LAN address, or a DNS SAN for a name the phone can resolve
  — a Bonjour-advertised `laptop.local`, or a name pinned in the
  household's router DNS.
- **Each device trusts the CA that signed it.** The CA root cert is
  installed as a system-trusted root on every device that needs to
  connect. On iOS: install the profile, then flip Full Trust on
  under Settings → General → About → Certificate Trust Settings.
  On Android: Settings → Security → Encryption & credentials →
  Install a certificate → CA certificate; Android shows a permanent
  "Network may be monitored" warning, which is cosmetic but does
  not go away.
- **The host serves on the cert-bound name.** Pick a hostname and
  use it consistently; Safari is fussier about IP SANs than Chrome.

`mkcert` handles all three with one tool: it generates a local CA on
the laptop, installs the root into the laptop's own trust store, and
issues a cert covering the names you list (e.g.
`mkcert laptop.local 192.168.1.42 localhost 127.0.0.1`). The CA
root file then has to reach every other device in the household once,
through whatever channel they already trust each other on — AirDrop,
a USB stick, a QR code that points at a file the laptop is serving.
From that point every device on the LAN gets a real Secure Context
against the household's host, and the rest of the platform works as
designed.

The cost is per device, once: whoever sets the household up does
the install on each phone, tablet and laptop that joins, including a
kid's tablet bought next year. That ceremony is the price of keeping
SPA delivery off any third party. It is the right trade-off for some
households (technical user, all devices owned by the same person,
strong preference for no external endpoints) and the wrong one for
others (mixed-technical household, devices come and go); the
platform supports both by leaving option 3 in place as a default.

## What persists when devices leave the LAN

Once two devices have paired, identity is keys, not network position.
The phone and the laptop recognise each other from any network they
later turn up on. Mesh state replicates whenever any two paired
devices are simultaneously reachable, in either direction.

The condition is the word "reachable." A WebRTC session is set up
fresh on every reconnect (network change, tab close, cellular
hop), and that setup needs a signalling rendezvous both sides can
hit, plus TURN if direct NAT traversal fails. The LAN signalling
endpoint covered both sides only while both sides were on the LAN.
Off it, the household needs a relay reachable from wherever its
devices currently are — one of the placement options above. The
data plane stays peer-to-peer; the relay still sees ciphertext.

Adding a third device while the household is scattered works under
the same condition. The admin's user key, carried by every device
they have paired in, can sign a new invite from anywhere. The new
device joining still needs a signalling relay reachable from itself
and at least one paired peer, for the seconds it takes to exchange
SDP and ICE.

A useful property falls out of this: **the LAN-only path bootstraps
the household's first trust relationship without touching anything
cloud-resembling.** Once two devices have paired that way, the
household has identity plus at least one peer relationship — and
from that point can choose how to handle "now we're not on the LAN"
(point at a shared relay, expose one of its own always-on devices,
install an overlay) without redoing the bootstrap.

## What is verified end-to-end against the deployed Fly stack (2026-05-14)

Every component this document describes is implemented and exercised.
The state of each piece against real Chrome 148 + `fairfox.fly.dev`
as of this writing:

- **Storage layer (browser side):** healthy. Polly 0.61.0 bounds the
  two storage awaits inside `buildHandleFactory` with a 5s timeout,
  and the Help-tab diagnostic surfaces a named `storageOpenError`
  when the underlying IndexedDB hangs. The polly#107 IndexedDB-zombie
  case that hung an earlier session is now a named failure rather
  than indefinite silence, with a one-click `StorageHealthBanner`
  recovery wired to the `app.clear-local-mesh` action.
- **`$meshState` wrappers:** healthy. Fresh seed of `fairfox-mesh`
  has all seventeen wrappers exit `seeded-and-imported,
  handleRegistered: yes, handleState: ready` with zero
  duplicate-docId entries.
- **CLI-side `$meshState` pipeline:** verified end-to-end.
  `scripts/e2e-chat-relay.ts` writes a pending message, the relay
  picks it up, writes a reply, the dump asserts the state — all
  inside a disposable HOME with the real polly storage adapters.
- **Browser ↔ CLI pairing through Fly signalling:** verified
  end-to-end. `scripts/e2e-fly-turn-relay.ts` against
  `fairfox.fly.dev/agenda`: a fresh puppeteer Chrome 148 profile
  bootstraps an identity, opens a pairing QR, the CLI consumes
  the URL and emits its `pair-return` frame, the browser's
  mesh-gate hash consumer advances to the hub, the CLI starts a
  long-lived daemon, and the daemon heartbeat reports `peers=1`
  within seconds. The pairing ceremony, the signalling
  pair-return route, and the WebRTC data channel between browser
  and CLI all work without manual intervention.
- **Two-device document sync over WebRTC:** verified. The
  daemon's `peers=1` heartbeat reads polly's `MeshClient.peers`
  count, which only registers a peer once SDP + ICE have
  completed and a data channel is open between the two endpoints
  through the Fly TURN relay. The architecture's data plane is
  carrying bytes between real devices.

The diagnostic ladder (Help-tab panel) and the `StorageHealthBanner`
recovery surface remain in place. They cost nothing on healthy boots
and pay for themselves the next time something hangs.

## Open trade-offs

- **TURN is the awkward dependency.** Some device pairs cannot
  establish a direct WebRTC flow (symmetric NAT, browser↔CLI across
  networks, restrictive corporate firewalls) and need a TURN relay
  to carry the encrypted media. TURN costs bandwidth and operator
  attention; "no new infrastructure" reads cleanly only as long as
  someone in the network keeps a TURN endpoint alive. The honest
  position is that fully cross-network households either ship with
  a default TURN (current state) or accept occasional pairing
  failures and a manual switch-network step.
- **Always-on for catch-up.** The mesh converges whenever any two
  paired devices meet. With twelve devices in a household this is
  effectively continuous. With two devices and no overlap in their
  online hours, edits take longer to propagate than the product
  vision implies. A headless peer running in `node` mode closes the
  gap without adding a privileged actor: it is just another replica
  with a device key, no user key, indistinguishable in the protocol
  from the user's phone.
- **Discoverability versus self-containment.** mDNS works on a real
  LAN and fails inside browsers, container networks, phones on
  carrier-grade NAT and guest wifi. The shared-relay fallback costs
  a small operational dependency (a stateless WebSocket someone has
  to run) in exchange for a flow that works every time.
- **CLI ≡ browser surface.** True today for every sub-app that uses
  `$meshState` end-to-end. New sub-apps must keep it true: action
  handlers belong in `packages/shared` and the per-sub-app action
  map, not behind HTTP routes only the SPA can reach.
- **Document growth.** Automerge documents accumulate history;
  tombstones are not garbage-collected. Long-lived sub-apps will
  eventually want a compaction story — a periodic re-snapshot under
  a new document key with the old one archived. Designed in
  [`docs/adr/0008-document-compaction-via-versioned-docids.md`](docs/adr/0008-document-compaction-via-versioned-docids.md);
  not yet implemented.
- **Graceful storage-layer recovery.** A wedged IndexedDB database
  (zombie connection from a previous renderer crash, blocked
  `versionchange`, transaction deadlock) leaves the SPA's mesh
  storage indefinitely unresponsive. Polly 0.61.0 turns that from
  silent indefinite hang into a named `meshStateModule.storageOpenError`
  field within five seconds. The fairfox-side half — surfacing a
  one-click "clear local mesh" recovery action when that field is
  populated — is the next move; until it lands, the recovery is a
  Chrome restart, which fails the "abandon a household without
  residue" product story.
