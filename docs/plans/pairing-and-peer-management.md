# Pairing and peer management

A design for three adjacent improvements to the mesh user experience:
signalling-relayed return tokens so pairing is one-action instead of
two, self-declared device names so the UI shows "Alex's laptop"
instead of a public-key prefix, and a peer list with per-peer
reconnect and a locally-scoped "forget" action. The three changes
land as one coherent story: the user pairs a device in a single QR
scan, the device shows up in the peer list with a sensible name, and
either side can prune the relationship when they want to.

## Problem

The current pairing wizard asks each side of the pair to accept the
other's token. The first half works well on a phone with a camera:
desktop issues a QR, phone scans, phone accepts. The second half
fails the sniff test: phone now displays its own QR or token for the
desktop to consume. A desktop without a camera either squints at the
phone and types the token, or pastes the share URL its partner sent
over some other channel. The flow works, it is simply three actions
when it wants to be one.

Once paired, the device becomes a public key the user never chose —
the only surface it has is its derived peer-id, an eight-character
hash fragment, and the browser's address bar and the CLI's output
both show it as such. The user has no way to identify which peer is
their phone, which is their partner's laptop, which is a CLI they
set up on a server a month ago. The peer list does not exist.

The mesh has no revocation primitive. A lost device still holds the
keyring it was paired with and can read everything encrypted under
the shared mesh keys. The current fix is ceremonial — re-pair every
other device, accept that the lost device is the mesh's responsibility
until the keys rotate.

## Design

### 1. Signalling-relayed return token

The existing signalling WebSocket already carries pairing-adjacent
traffic: once both devices connect with their own peer ids, the server
knows they are both present. Relaying a one-shot pairing-return
message over that same socket eliminates the manual return paste.

The issuer side of the wizard subscribes to a `pair-return` frame on
the signalling socket, keyed by the pairing-session id it embedded in
the issued token. The scanning side, once it has accepted the token
and derived its own reciprocal token, sends a `pair-return` frame on
the signalling socket with the same session id and its own token in
the payload. The server matches the session id to the waiting issuer
socket and delivers the frame.

```
Issuer (desktop)                 Server                Scanner (phone)
    |                               |                        |
    | join peerId=Ai, session=S     |                        |
    |------------------------------>|                        |
    | show QR containing share URL  |                        |
    |                               |                   scan QR
    |                               |    join peerId=Bj       |
    |                               |<------------------------|
    |                               |    derive reciprocal    |
    |                               |                 token T'|
    |                               |   pair-return S, T'     |
    |                               |<------------------------|
    |      pair-return S, T'        |                        |
    |<------------------------------|                        |
    |  apply T', wizard exits       |                        |
```

The payload is the same base64 token the scanner would otherwise
display. The server is a dumb router — it never decrypts, never
stores, never retains state after delivery. A return frame for a
session with no waiting issuer is silently dropped, which makes the
feature idempotent under retries.

Session ids are 16 random bytes encoded as 22 base64 characters, good
enough to be unguessable within the 5-minute TTL of a pairing
ceremony. They go into the issued token alongside the existing fields
and are extracted on the scanner side when it builds the return
frame.

Fallback: the existing paste interface stays. If the scanner and
issuer can't both talk to the signalling server for some reason —
different network, server down, strict firewall — the user falls
back to the current manual-paste flow from the same screen. The new
path is an additional surface, not a replacement.

#### Protocol additions

Two new frame types on the existing `SIGNALING_PATH` WebSocket, on
top of the existing `join` / `signal` / `peer-joined` / `peer-left`
vocabulary:

- `pair-issue`: `{ type: 'pair-issue', sessionId }` — sent by the
  issuer when the wizard enters issue mode. Server stores
  `sessionId → socket` with a five-minute TTL. Re-issuing under the
  same session id replaces the entry.
- `pair-return`: `{ type: 'pair-return', sessionId, token }` — sent
  by the scanner after it accepts and derives its reciprocal. Server
  looks up the session, forwards `{ type: 'pair-return', token }` to
  the waiting issuer socket, then drops the session.

Out-of-band errors (`session-not-found`, `session-expired`) are
surfaced as `pair-error` frames the issuer can show in the wizard.
The issuer's `pair-issue` has a cost bound (at most one active
session per socket) so a malformed client can't exhaust memory.

#### Wizard changes

The `IssueView` component in `login-page.tsx`:

- on open, sends `pair-issue` and transitions to a waiting state
- renders the QR and token as today
- listens for `pair-return`; on arrival, feeds the token through
  `applyScannedToken` and resolves the ceremony
- keeps the existing "I've entered their token manually" button as
  fallback
- shows a small muted indicator — "waiting for the other device…" —
  so the flow is legible when the network is slow

The scanner side needs a single addition: after the scan accept path
generates the reciprocal token, it also emits a `pair-return` frame
before closing the wizard. The user sees only the "done" state.

### 2. Self-declared device names

Names live in a new mesh document, `mesh:devices`, shaped as a map
from peer-id to `{ name, lastSeen, labels? }`. Each device writes
only the entry for its own peer-id. Readers trust what they find.
The mesh is already a trust boundary — any paired device can write
to any mesh doc — so adding one more doc changes no threat model.

The record:

```ts
interface DeviceEntry {
  peerId: string;       // derived from the peer's public key
  name: string;         // self-chosen, freely editable
  createdAt: string;    // first time this device announced itself
  lastSeenAt: string;   // bumped on each mesh connection
  agent?: 'browser' | 'cli' | 'extension';
}

interface DevicesDoc {
  devices: Record<string, DeviceEntry>;
}
```

On first pairing, the wizard prompts for a device name (prefilled
with a sensible default — the browser's user agent family, the
hostname on the CLI, or "fairfox extension" for the side panel). The
pairing ceremony's `pairing.accept` action writes the new entry
atomically with the keyring mutation that accepts the token. Every
subsequent mesh-client open updates `lastSeenAt`.

The peer list surfaces `name` as the primary label and falls back to
the peer-id prefix if the entry is missing — which it will be for
peers paired before this document existed. A banner on the peer list
surfaces "unnamed devices" with a nudge to open each and name itself
on next use; the mesh eventually reaches a fully-named state without
a migration.

### 3. Peer list and management

A new view at `/peers` on the home sub-app (tab or sibling page —
design decision below) shows every entry from `mesh:devices`
augmented with presence from the signalling server. Each row carries:

- **Name** (from `mesh:devices`), peer-id prefix, agent kind, time
  since last seen
- **Online indicator** — green dot if the signalling server reports
  the peer present, grey otherwise
- **Reconnect** — closes the WebRTC channel to this peer and lets
  the signalling round-trip re-establish it. Scope: local. The
  paired device on the other side is unaware anything happened
  beyond a brief disconnect
- **Forget locally** — removes the peer from *this* device's
  keyring and closes the connection. Honest label: "this device
  stops syncing with the peer, but the peer still holds the shared
  mesh keys." A confirmation dialog surfaces that scope in plain
  words
- **Rename** — only on the row representing this device, writes to
  the `mesh:devices` doc

The page renders the current device at the top with a "this device"
badge, in case the user gets lost. The header of the page shows the
device's own peer-id for debugging copy-paste.

**Where it lives.** Three plausible homes:

- A **new tab on home** — alongside the sub-app grid. Visible from
  the moment a user pairs. Feels like the natural home; home is
  where the mesh's identity already lives.
- A **sub-page** `/peers` — routed directly. Less discoverable, more
  deep-link-friendly.
- A **settings sub-app** — the beginning of a broader settings
  surface. Overkill for now; one page of settings doesn't merit a
  new bundle.

I lean toward the first: a "Peers" link on the home sub-app, not a
separate app. The home is the right place because pairing lives
there already.

### 4. Reconnect, honestly scoped

`Reconnect <peer>` calls a new `mesh.reconnect-peer(peerId)` action.
The action:

1. Looks up the WebRTC session for this peer in the mesh client.
2. Closes the session.
3. Re-sends the `join` frame to the signalling server, which
   triggers the incumbent logic and re-negotiates the WebRTC
   connection.

No keyring mutation. No mesh key change. The user gets a spinner for
the few seconds it takes for the signalling round-trip.

"Reconnect all peers" is a convenience for stuck-everywhere cases
— iterates the peers and reconnects each. Available as a single
button on the peer list header.

### 5. Forget locally vs revoke mesh-wide

"Forget locally" is available now:

1. Remove the peer from `keyring.knownPeers` on this device.
2. Close the WebRTC connection to the peer.
3. Leave `mesh:devices` alone — other peers still see the forgotten
   peer in their lists. This is correct: the mesh still trusts it.
4. The forgotten peer can still read shared documents from any
   other paired device it can reach. The forget dialog says so in
   plain prose.

"Revoke mesh-wide" is deferred. It requires:

- rotating the mesh encryption keys on this device
- distributing the new keys to every remaining peer over a
  mesh-level message type
- re-encrypting (or at least re-publishing under the new key) every
  mesh document so the old keys stop working
- a UI for acknowledging that a recently-offline peer will miss the
  rotation and be silently dropped

A separate design document will pick this up when the use case
surfaces. For now we ship the halfway with an explicit scope
callout, because the halfway is already useful: "my phone was
stolen, stop syncing it from my laptop" is solved; "make sure my
stolen phone can never see another update" isn't, and pretending
otherwise would be worse than naming the gap.

## Rollout order

One commit per improvement, each behind a small feature flag in the
home sub-app so the half-built experience doesn't leak onto prod.

1. **`mesh:devices` document + rename in wizard.** No UI beyond a
   single "what should we call this device" input during pairing and
   on the existing "Pair another device" flow. Back-compat: missing
   entries render as peer-id prefix. No signalling changes.
2. **Peer list.** A new `/peers` route on the home sub-app with the
   name from `mesh:devices` and presence from the signalling server
   (new `peers-online` query frame on the existing signalling
   socket). Reconnect and forget-locally buttons included. The view
   is read-only until 1 has landed so names show up immediately.
3. **Signalling-relayed return token.** New `pair-issue` /
   `pair-return` frames server-side. Wizard updates to listen for
   the return frame and auto-complete. Manual paste stays as
   fallback. Signalling server adds the cost bound and TTL.

In that order because (1) is independent, (2) needs (1) to render
names, and (3) is the biggest single change and benefits from
having the peer list already in place to verify the ceremony
landed cleanly.

## Open questions

- **Pairing session id overlap with existing pairing metadata.**
  The token format already contains a short freshness marker; can
  the session id be the same field, or does relaying require its
  own id? Decide when implementing (1) lands.
- **"Forget me" from the forgotten side.** Should a booted device
  get a signal that it was removed, or should silence be the
  protocol? Silence is simpler and matches how the mesh already
  works after a close; a signal opens a social-engineering surface
  ("why did they remove me?"). Default: silence.
- **Peer list on the CLI.** `fairfox peers` is the obvious mirror
  of the browser view — list, rename-self, forget, reconnect.
  Build it alongside the browser view or as a follow-up?
  Follow-up feels right: the CLI is a sharper tool and rarely needs
  the "I lost my phone" affordance.
- **Offline peer detection.** The signalling server knows who is
  connected right now, not who is actually reachable via WebRTC.
  "Online" on the peer list is best-effort; the status might be
  green while the peer is stuck on a signalling socket with a dead
  data channel. Tolerable for v1; a keepalive ping between
  connected peers would sharpen it if it becomes noisy.
