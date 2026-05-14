// Mesh connection helper for the CLI. Wraps polly's createMeshClient with
// the Node WebRTC implementation (werift), file-backed keyring storage
// under ~/.fairfox/keyring.json, and the WebSocket global that Bun
// already exposes. Shared by every subcommand that reaches into the mesh.

import { hostname } from 'node:os';
import type { DocumentId } from '@automerge/automerge-repo/slim';
import { interpretAsDocumentId, isValidDocumentId } from '@automerge/automerge-repo/slim';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { devicesState, harvestPeerKeys, touchSelfDeviceEntry } from '@fairfox/shared/devices-state';
import { currentDocIdForKey, DOCUMENT_INDEX_KEY } from '@fairfox/shared/document-index-state';
import { awaitLoadedBudget } from '@fairfox/shared/loaded-budget';
import type { KeyringStorage, MeshClient } from '@fairfox/shared/polly';
import {
  configureMeshState,
  createMeshClient,
  fileKeyringStorage,
  Repo,
  registerDocIdResolver,
} from '@fairfox/shared/polly';
import { RTCPeerConnection } from 'werift';
import { fairfoxPath } from '#src/paths.ts';

// Path getters resolve FAIRFOX_HOME each call so two CLI processes
// with different env can share this module without aliasing. The
// function-style export looks like a constant to existing callers
// — `fairfoxPath` evaluates to a stable string per process so each
// consumer's `KEYRING_PATH` value is computed once at import time.
// If you need a different path within a single process, pass
// FAIRFOX_HOME via the subprocess env, not via runtime mutation.
export const KEYRING_PATH = fairfoxPath('keyring.json');
export const REPO_STORAGE_PATH = fairfoxPath('mesh');

// ADR 0008: register the docId resolver once at module init. polly
// keeps the registration at module scope, so a single call covers
// every subsequent `openMeshClient` / `openMeshClientReadOnly`
// invocation in this process. The resolver short-circuits on the
// index doc's own key to avoid recursion when its wrapper is being
// constructed.
registerDocIdResolver((key) => {
  if (key === DOCUMENT_INDEX_KEY) {
    return undefined;
  }
  const stored = currentDocIdForKey(key);
  if (!stored || !isValidDocumentId(stored)) {
    return undefined;
  }
  try {
    return interpretAsDocumentId(stored);
  } catch {
    return undefined;
  }
});

export function defaultSignalingUrl(): string {
  const base = process.env.FAIRFOX_URL ?? 'https://fairfox.fly.dev';
  const proto = base.startsWith('https') ? 'wss' : 'ws';
  const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `${proto}://${host}/polly/signaling`;
}

/** HTTP(S) origin that hosts the relay's REST routes (e.g.
 * `/turn-credentials`). Derived from the same env knob as the
 * signalling URL so a single override moves both. */
export function defaultRelayOrigin(): string {
  return process.env.FAIRFOX_URL ?? 'https://fairfox.fly.dev';
}

export function keyringStorage(): KeyringStorage {
  return fileKeyringStorage(KEYRING_PATH);
}

export function derivePeerId(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ConnectOptions {
  peerId: string;
  signalingUrl?: string;
  /** Optional custom-frame subscription — forwarded to polly's
   * `signaling.onCustomFrame`. The `mesh invite open` command uses
   * this to listen for pair-return frames while the QR is on
   * screen. */
  onCustomFrame?: (frame: { type: string; [k: string]: unknown }) => void;
}

/**
 * Open a mesh client using the on-disk keyring. Caller is responsible
 * for `await client.close()` when done. Also writes this CLI's own
 * entry into the `mesh:devices` document (or bumps `lastSeenAt` if it
 * already exists), so `fairfox peers` and the browser's peer list
 * show the CLI under a sensible default name — the machine's
 * hostname — which the user can rename later.
 */
export async function openMeshClient(options: ConnectOptions): Promise<MeshClient> {
  const client = await createMeshClient({
    signaling: {
      url: options.signalingUrl ?? defaultSignalingUrl(),
      peerId: options.peerId,
      onCustomFrame: options.onCustomFrame,
    },
    keyring: { storage: keyringStorage() },
    // Persist the Automerge docs to disk so the CLI is a real peer
    // — writes land in ~/.fairfox/mesh/ and survive process exit,
    // even when no other peer is connected at write time.
    repoStorage: new NodeFSStorageAdapter(REPO_STORAGE_PATH),
    // werift's RTCPeerConnection implements the subset polly needs but
    // doesn't declare the full DOM spec (e.g. `generateCertificate`),
    // so the cast bridges the structural gap. The rtc field only uses
    // the instance-level API (createOffer/createAnswer/data channels)
    // which werift does satisfy.
    rtc: {
      // biome-ignore lint/suspicious/noExplicitAny: werift shim to DOM type
      RTCPeerConnection: RTCPeerConnection as unknown as any,
      // Same TURN flow as the browser side. Without this, werift only
      // sees Chrome's mDNS-obfuscated `.local` candidates from the
      // browser side and can't resolve them — ICE fails silently and
      // browser↔CLI pairs never establish a data channel.
      iceCredentialResolver: async () => {
        const url = `${defaultRelayOrigin().replace(/\/$/, '')}/turn-credentials`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
          throw new Error(`turn-credentials: HTTP ${res.status}`);
        }
        const body = await res.json();
        if (!body || typeof body !== 'object' || !Array.isArray(body.iceServers)) {
          throw new Error('turn-credentials: unexpected response shape');
        }
        return body.iceServers as unknown as RTCIceServer[];
      },
    },
  });
  // The `mesh:devices` write happens against the same Repo the client
  // just configured; $meshState is safe to call after createMeshClient
  // returns. The write runs fire-and-forget — the document handle
  // buffers locally and flushes on `flushOutgoing` at command exit.
  try {
    // Wait for the primitive's storage-hydration to complete before
    // writing. Otherwise a fresh CLI touches the self-row into the
    // in-memory signal, storage then loads its (older) copy over the
    // top, and the self-row never reaches the Automerge doc at all —
    // which is why `fairfox peers` saw every peer but itself.
    //
    // Budget the wait: polly's $meshState `.loaded` resolves once the
    // handle reaches `ready`, which routes through Automerge's repo
    // and can stall for tens of seconds when storage's bytes haven't
    // yet driven the handle out of `loading`. Every CLI command
    // flows through this code path; an unbounded wait makes
    // `fairfox users`, `fairfox peers`, every command sit at 50+
    // seconds before printing. CRDT reconciliation on the next
    // command re-merges anything that arrived after the budget;
    // missing a fresh self-row touch is preferable to making every
    // read feel broken.
    await awaitLoadedBudget(devicesState.loaded, 3000);
    // Publish our pubkey in mesh:devices so other peers can harvest
    // it and add us to their keyring without a pair-token exchange.
    const storage = keyringStorage();
    const keyring = await storage.load();
    const publicKey = keyring?.identity.publicKey;
    touchSelfDeviceEntry(options.peerId, {
      agent: 'cli',
      defaultName: hostname(),
      ...(publicKey ? { publicKey } : {}),
    });
    // Harvest unknown pubkeys from mesh:devices into the CLI's
    // keyring. If any land, persist them — the running MeshClient
    // won't pick them up without a restart, but the next CLI
    // invocation will be a full-trust peer.
    if (keyring) {
      const added = harvestPeerKeys(keyring);
      if (added.length > 0) {
        await storage.save(keyring);
      }
    }
  } catch {
    // Never block a CLI invocation on device-entry housekeeping.
  }
  return client;
}

/**
 * Wait until the Automerge Repo reports at least one peer, or the
 * deadline elapses. Callers that only want to _read_ the current state
 * can tolerate a zero-peer exit; callers that mutate should insist on
 * convergence.
 */
export async function waitForPeer(client: MeshClient, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.repo.peers.length > 0) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return client.repo.peers.length > 0;
}

/**
 * Give Automerge a little slack after a mutation so sync messages have
 * a chance to reach every connected peer before the process exits.
 */
export async function flushOutgoing(ms = 1500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Close a mesh client durably. Always pair with the corresponding
 * `await openMeshClient(...)` rather than calling `client.close()`
 * directly: the bare polly close runs `repo.shutdown()` but does
 * NOT block on storage-adapter writes draining, so a CLI that
 * writes-then-exits (mesh init, todo task add, chat send, users
 * invite, …) can lose the in-flight write to disk and a follow-up
 * read sees an empty doc. Calling `repo.flush()` first blocks
 * until every dirty doc is persistent.
 */
/** Collect the DocumentId of every handle currently in `ready` state.
 * Used to filter `repo.flush()` — calling `handle.doc()` (which
 * flush does internally per handle) throws on a handle still in
 * `loading`. The branded `DocumentId` type is read off
 * `handle.documentId` so the result is typed correctly without a
 * cast through `string`. */
function readyHandleIds(repo: Repo): DocumentId[] {
  const ids: DocumentId[] = [];
  for (const handle of Object.values(repo.handles)) {
    if (handle?.state === 'ready') {
      ids.push(handle.documentId);
    }
  }
  return ids;
}

export interface ReadOnlyMesh {
  readonly repo: Repo;
  close(): Promise<void>;
}

/**
 * Open a network-less Repo for read-only CLI commands. No signalling
 * connection, no WebRTC slot, no `peerId`-on-the-wire — so a
 * short-lived `fairfox peers`, `fairfox users`, etc. doesn't race
 * the running `fairfox daemon` for the shared keyring's peerId on
 * the signalling server. The trade-off: data is whatever the
 * daemon (or a previous mesh-client invocation) last persisted to
 * `~/.fairfox/mesh/`. For read commands where the data only flows
 * one way — daemon writes, CLI displays — that's the right
 * trade.
 *
 * Encryption is on the network adapter, not at rest, so reading
 * straight from the NodeFS adapter without a keyring is safe.
 * `configureMeshState` is called against the new Repo so the
 * `$meshState` wrappers' lazy `defaultRepo` resolution finds this
 * Repo (not the previous one, if any) on first `.value` access.
 */
export function openMeshClientReadOnly(): ReadOnlyMesh {
  const repo = new Repo({
    storage: new NodeFSStorageAdapter(REPO_STORAGE_PATH),
    isEphemeral: true,
  });
  configureMeshState(repo);
  return {
    repo,
    close: async (): Promise<void> => {
      try {
        await repo.flush(readyHandleIds(repo));
      } catch {
        // best-effort
      }
      try {
        await repo.shutdown();
      } catch {
        // best-effort — same DocHandle-not-ready shape as the
        // networked path's close.
      }
    },
  };
}

export async function closeMesh(client: MeshClient): Promise<void> {
  try {
    // Two passes: the first flush ensures any in-flight Automerge
    // change ops are queued at the storage adapter. The 200 ms
    // settle gives polly's signal→handle effect chain a chance
    // to run for any pending writes (`signal.value = ...`
    // triggers an effect that calls handle.change, which queues
    // to storage — without the settle, repo.flush can return
    // before the queue receives the writes). Then a final flush
    // drains everything to disk.
    //
    // Filter to ready handles: `repo.flush()` with no args iterates
    // every handle and calls `handle.doc()`, which throws on any
    // handle still in `loading` state. Budgeted `devicesState.loaded`
    // in `openMeshClient` lets the function return before every
    // wrapper handle hydrates, so a short read command can carry a
    // loading handle into teardown. Passing the explicit docId list
    // makes the flush skip the loaders cleanly.
    const readyIds = readyHandleIds(client.repo);
    await client.repo.flush(readyIds);
    await new Promise((r) => setTimeout(r, 200));
    await client.repo.flush(readyIds);
  } catch {
    // best-effort; even if flush throws, still close.
  }
  try {
    // `client.close()` → `repo.shutdown()` → `repo.flush()` with no
    // args — iterates every handle including loaders and throws as
    // above. The data we cared about already landed in the filtered
    // flushes above; this internal flush is now redundant. Swallow
    // the throw for the same reason the explicit flush catch does:
    // the command's user-facing output has already been written; a
    // teardown error from a still-loading handle is noise.
    await client.close();
  } catch {
    // best-effort
  }
}
