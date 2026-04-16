# 0003 — Authentication via Ed25519 device key pairs

**Status:** Accepted (revised 2026-04-16, supersedes 0003 "seven hardcoded passphrases")
**Date:** 2026-04-16

## Context and problem statement

Fairfox is private family infrastructure used by seven known people: Alex, Elisa, Leo, Vito, Ornella, Olly, and Trish. Under the `$meshState` architecture the server never holds or processes sub-app data, so server-side JWT validation has no role. Identity must be cryptographic and per-device rather than per-session, because every mutation in the Automerge CRDT carries the signer's public key for attribution and every peer verifies signatures before accepting changes.

## Decision drivers

- The server is not on the data path; it cannot validate cookies or issue tokens.
- Every `$meshState` mutation must be signed so that peers can verify authorship and reject forged changes.
- Per-action attribution matters: the agenda fairness report needs to know which person marked a chore done.
- The user list is fixed and small; a full PKI is unnecessary.
- Onboarding a new device should be a brief physical-proximity ceremony, not a registration flow.

## Decision

Each device generates an Ed25519 key pair on first launch and stores it in a `MeshKeyring` persisted to IndexedDB. The key pair is the device's identity — the secret key never leaves the device. Onboarding a new device uses Polly's pairing token flow: a trusted device displays a QR code encoding the issuer's public key and the document encryption key; the new device scans the QR code, applies the token to its keyring, and begins syncing. The new device's own public key reaches other peers when it sends its first signed operation.

Alex's devices are the default revocation authority: if a device is compromised or retired, Alex creates a signed revocation record that propagates to every peer. Revoked peers' public keys are added to the keyring's `revokedPeers` set and the `MeshNetworkAdapter` drops all further messages from them.

The seven family members are identified by mapping public keys to names in a known-peers registry that is itself a `$meshState` document, bootstrapped during the first pairing. The `system` identity (for cron and agent-initiated writes) is a reserved key pair held by the server, reachable only through LLM proxy routes.

> In the context of a private family hub where the server never touches sub-app data and every mutation must be cryptographically signed, facing the requirement that identity is per-device and onboarding is a brief physical ceremony, we decided for Ed25519 key pairs in IndexedDB with QR-based pairing tokens, against server-side JWT cookies or OAuth, to achieve zero server-side auth state and cryptographic per-action attribution.

## Considered alternatives

- **Server-side JWT via hardcoded passphrases.** The original ADR 0003. Rejected because the server is no longer on the data path and cannot validate cookies.
- **OAuth via Google or similar.** Rejected because it adds a third-party dependency for a fixed user list and does not provide the cryptographic signing that CRDT replication requires.
- **Shared passphrase per person (symmetric).** Rejected because symmetric secrets cannot distinguish which of a person's devices signed a mutation.

## Consequences

**Good:**
- Zero server-side auth state; nothing to back up, corrupt, or leak.
- Per-action attribution comes for free: every signed mutation carries the signer's public key.
- Onboarding is a brief physical ceremony (scan a QR code) rather than a form.
- Revocation is immediate and propagates to every peer without server involvement.
- The model scales to any number of devices per person without server changes.

**Bad:**
- A lost device's key pair cannot be recovered; the device must be revoked and a new one paired.
- The pairing ceremony requires physical proximity (or a secure out-of-band channel for the QR data).
- Key management complexity is higher than passwords: the keyring must be persisted carefully and IndexedDB must not be cleared accidentally.
- There is no self-service "forgot my key" recovery; Alex must re-pair the person's new device.
