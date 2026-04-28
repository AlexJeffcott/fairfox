// Single source of truth for the CLI's on-disk state location.
//
// By default the CLI plants everything under `~/.fairfox/` —
// keyring, Automerge storage, user identity, invites, update
// stamp, daemon logs. That works for one-install-per-machine but
// breaks every test that wants two CLIs cohabiting: both processes
// derive their peerId from the same keyring's identity public key,
// the signalling server allows one socket per peerId, and the
// second CLI evicts the first.
//
// `FAIRFOX_HOME` overrides the dir directly. Set
//
//     FAIRFOX_HOME=/tmp/fairfox-laptop fairfox mesh init …
//     FAIRFOX_HOME=/tmp/fairfox-phone fairfox pair …
//
// and the two installs share nothing — separate keyrings, separate
// mesh storage, separate everything. The signalling server sees
// them as distinct peers, WebRTC negotiates between them, and a
// real two-device round-trip works on one laptop without a phone.
//
// Inside the e2e harnesses, prefer FAIRFOX_HOME over the older
// `HOME=/tmp/...` redirect: HOME also affects unrelated tools (the
// Anthropic Agent SDK looks under HOME for its config, the claude
// binary path lookup walks PATH from HOME-derived shells, etc.) and
// stomping on those produces false negatives.

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The fairfox dir for this process. Lazy so a test that sets
 * `FAIRFOX_HOME` after this module imports still picks it up
 * — every consumer goes through the function, never a top-level
 * constant. */
export function fairfoxHome(): string {
  return process.env.FAIRFOX_HOME ?? join(homedir(), '.fairfox');
}

/** Path within the fairfox dir. Convenience wrapper so callers
 * read the same way as the existing `join(homedir(), '.fairfox',
 * 'keyring.json')` pattern they're replacing. */
export function fairfoxPath(...parts: string[]): string {
  return join(fairfoxHome(), ...parts);
}
