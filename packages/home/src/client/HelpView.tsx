/** @jsxImportSource preact */
// HelpView — a quick-start page for people who land on a paired
// device and want to know how the moving parts fit together. Same
// content as README.md's quick-start section, rendered for a
// browser audience.

import { OBSERVED_MESH_STATE_MODULE_ID_FROM_AGENDA } from '@fairfox/agenda/state';
import { MESH_STATE_MODULE_ID } from '@fairfox/polly/mesh';
import { Button, Cluster, Code, Layout, Surface, Text } from '@fairfox/polly/ui';
import { renderMarkdown } from '@fairfox/polly/ui/markdown';
import { devicesState } from '@fairfox/shared/devices-state';
import { mesh } from '@fairfox/shared/ensure-mesh';
import {
  lastSignalingErrorMessage,
  signalingConnected,
} from '@fairfox/shared/mesh-connection-state';
import { meshFingerprintText, meshMetaState } from '@fairfox/shared/mesh-meta-state';
import { peersPresent } from '@fairfox/shared/peers-presence';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import {
  OBSERVED_MESH_STATE_MODULE_ID_FROM_USERS_STATE,
  usersState,
} from '@fairfox/shared/users-state';
import { signal } from '@preact/signals';
import { docSizesHasSealed, docSizesText, refreshDocSizes } from '#src/client/doc-sizes.ts';
import { selfPeerId } from '#src/client/self-peer.ts';

// HelpView's own view of the polly mesh-state module id. Compared
// against the snapshot's `meshStateModule.moduleId` plus the
// OBSERVED_* re-exports from each candidate consumer subtree to
// rule polly#107 H5 in or out in one rendered read.
const OBSERVED_MESH_STATE_MODULE_ID_FROM_HELPVIEW = MESH_STATE_MODULE_ID;

// A help section: a bold heading over a body built from ordered
// parts. Prose parts are markdown strings rendered through polly's
// `renderMarkdown` (`marked` + DOMPurify — `**bold**`, `*italic*`,
// `` `code` ``, lists). Code parts render as polly's `<Code block>`,
// which — unlike a markdown fenced block — stays width-bounded and
// scrolls on a narrow phone viewport rather than overflowing it.
type HelpPart = { readonly prose: string } | { readonly code: string };

function Section({
  heading,
  parts,
}: {
  heading: string;
  parts: readonly HelpPart[];
}): preact.JSX.Element {
  return (
    <Layout rows="auto" columns="minmax(0, 1fr)" gap="var(--polly-space-sm)">
      <Text as="h2" size="lg" weight="bold">
        {heading}
      </Text>
      {parts.map((part) =>
        'code' in part ? (
          <Code key={part.code} block={true}>
            {part.code}
          </Code>
        ) : (
          <Text key={part.prose} as="div" tone="muted">
            {renderMarkdown(part.prose)}
          </Text>
        )
      )}
    </Layout>
  );
}

function readBundleHash(): string {
  if (typeof document === 'undefined') {
    return '(no document)';
  }
  const meta = document.querySelector('meta[name="fairfox-build-hash"]');
  return meta?.getAttribute('content') ?? '(no meta tag)';
}

function countOnlinePeers(): number {
  const set = peersPresent.value;
  const self = selfPeerId.value;
  let count = 0;
  for (const id of set) {
    if (id !== self) {
      count += 1;
    }
  }
  return count;
}

function buildDiagnosticsText(): string {
  const meshName = meshMetaState.value.name || '(unnamed)';
  const fp = meshFingerprintText.value || '(loading)';
  const peerId = selfPeerId.value ?? '(loading)';
  const identity = userIdentity.value;
  const userId = identity ? identity.userId : '(no user identity)';
  const displayName = identity?.displayName ?? '(no display name)';
  const buildHash = readBundleHash();
  const sigConnected = signalingConnected.value ? 'connected' : 'disconnected';
  const sigError = lastSignalingErrorMessage.value;
  const peersOnline = countOnlinePeers();
  const totalDevices = Object.keys(devicesState.value.devices).length;
  const totalUsers = Object.keys(usersState.value.users).length;
  const userAgent = typeof navigator === 'undefined' ? '(no navigator)' : navigator.userAgent;
  const origin = typeof window === 'undefined' ? '(no window)' : window.location.origin;

  // Plain key: value pairs so the textarea contents read like a
  // chat/email-friendly diagnostic dump. Mirrors the layout of
  // `fairfox doctor` so an issue report can paste this verbatim and
  // the on-call eye recognises every field.
  const lines: readonly string[] = [
    `mesh:           ${meshName} (${fp})`,
    `user:           ${displayName} (${userId})`,
    `device peerId:  ${peerId}`,
    `paired devices: ${totalDevices}`,
    `users:          ${totalUsers}`,
    `peers online:   ${peersOnline}`,
    `signalling:     ${sigConnected}${sigError ? ` (last error: ${sigError})` : ''}`,
    `build hash:     ${buildHash}`,
    `origin:         ${origin}`,
    `user-agent:     ${userAgent}`,
  ];
  return lines.join('\n');
}

/** A read-only textarea showing every non-secret state useful for
 * "is this device on the right mesh / build / signalling pool?".
 * Tapping the textarea fires `help.select-all-textarea` which marks
 * the whole content selected so the OS copy gesture lands the lot
 * — important on a mobile PWA where multi-select is fiddly. */
function Diagnostics(): preact.JSX.Element {
  const text = buildDiagnosticsText();
  const lineCount = text.split('\n').length;
  return (
    <Layout rows="auto auto" columns="minmax(0, 1fr)" gap="var(--polly-space-sm)">
      <Text as="h2" size="lg" weight="bold">
        Diagnostics
      </Text>
      <Text as="p" tone="muted">
        Tap the box to select everything for copy. Compare with another paired device's Help tab to
        confirm you're on the same mesh.
      </Text>
      <Surface variant="sunken">
        <textarea
          readOnly={true}
          rows={lineCount}
          value={text}
          data-action="help.select-all-textarea"
          data-help-snapshot="true"
        />
      </Surface>
    </Layout>
  );
}

// Polls polly's getPeerStateSnapshot every couple of seconds while the
// page is open. The snapshot is what fairfox uses to debug the
// "daemon dials, peers go up, but documents never hydrate" failure
// mode polly#105 left partially-open. Without this, every diagnostic
// has to come from a CDP-driven JS evaluation; with it, the failing
// device's own Help tab carries the wire-level evidence the next
// debugging session would otherwise have to re-discover.
const peerSnapshot = signal<string>('(loading…)');

function startSyncDiagnosticsPolling(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const m = mesh;
  if (!m) {
    return;
  }
  const tick = async (): Promise<void> => {
    // Skip ticking while the diagnostic textarea is focused so the
    // 2s autorefresh doesn't repeatedly rewrite the text mid-copy.
    // On mobile, selection state is lost the moment the field
    // re-renders — refreshing under the user's fingers makes the
    // snapshot effectively un-copyable. The autorefresh resumes on
    // blur.
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active instanceof HTMLTextAreaElement && active.dataset.helpSnapshot === 'true') {
      return;
    }
    try {
      await m.refreshTransportStats();
      const snap = m.getPeerStateSnapshot();
      const identity = collectClientIdentity(m);
      peerSnapshot.value = formatSyncDiagnostics(snap, identity);
    } catch (err) {
      peerSnapshot.value = `(error: ${err instanceof Error ? err.message : String(err)})`;
    }
  };
  void tick();
  window.setInterval(() => {
    void tick();
  }, 2000);
}

// biome-ignore lint/suspicious/noExplicitAny: polly's MeshConnection wraps internals (repo.networkSubsystem, repo.sharePolicy) the public type tree doesn't surface; loose at the diagnostic boundary
function collectClientIdentity(m: any): {
  repoPeerId: string;
  signalingPeerId: string;
  adapterClasses: string[];
  sharePolicy: string;
  localHandleIds: string[];
} {
  const repo = m.repo;
  const signaling = m.signaling;
  const adapters = repo?.networkSubsystem?.adapters ?? [];
  const adapterClasses = Array.isArray(adapters)
    ? // biome-ignore lint/suspicious/noExplicitAny: adapter objects vary by transport; constructor.name is the only stable identifier
      adapters.map((a: any) => a?.constructor?.name ?? '(unknown)')
    : [];
  const sharePolicyFn = repo?.sharePolicy;
  const sharePolicy =
    typeof sharePolicyFn === 'function'
      ? sharePolicyFn.toString().slice(0, 200)
      : `(non-function: ${typeof sharePolicyFn})`;
  const handles = repo?.handles ?? {};
  const localHandleIds = typeof handles === 'object' ? Object.keys(handles) : [];
  return {
    repoPeerId: typeof repo?.peerId === 'string' ? repo.peerId : '(none)',
    signalingPeerId: typeof signaling?.peerId === 'string' ? signaling.peerId : '(none)',
    adapterClasses,
    sharePolicy,
    localHandleIds,
  };
}

function formatSyncDiagnostics(
  // biome-ignore lint/suspicious/noExplicitAny: polly's snapshot type isn't re-exported through the shared wrapper; keep it loose at the diagnostic boundary
  snap: any,
  identity: {
    repoPeerId: string;
    signalingPeerId: string;
    adapterClasses: string[];
    sharePolicy: string;
    localHandleIds: string[];
  }
): string {
  const lines: string[] = [];
  // polly#107 client-identity fingerprint — the cheapest cut between
  // H5/H6 (repo identity, dup adapters), H7 (sharePolicy), H13
  // (repo↔signalling peerId mismatch), H4 (docId set).
  lines.push('=== client identity (polly#107) ===');
  lines.push(`repo.peerId:       ${identity.repoPeerId}`);
  lines.push(`signaling.peerId:  ${identity.signalingPeerId}`);
  lines.push(
    `  match:           ${identity.repoPeerId === identity.signalingPeerId ? 'yes' : 'NO ← H13'}`
  );
  lines.push(
    `adapters:          ${identity.adapterClasses.length} [${identity.adapterClasses.join(', ')}]`
  );
  lines.push(`sharePolicy:       ${identity.sharePolicy}`);
  // Prefer polly 0.58.0's snapshot-emitted handle data over our manual
  // repo.handles probe; the values agree but the snapshot side is
  // authored by polly and will track upstream changes.
  const snapHandleCount = snap?.repoHandleCount;
  const snapHandleIds = Array.isArray(snap?.repoHandleIds) ? snap.repoHandleIds : [];
  const handleCount =
    typeof snapHandleCount === 'number' ? snapHandleCount : identity.localHandleIds.length;
  const handleIds = snapHandleIds.length > 0 ? snapHandleIds : identity.localHandleIds;
  lines.push(
    `repo handles:      ${handleCount} (source: ${typeof snapHandleCount === 'number' ? 'snapshot' : 'probe'})`
  );
  for (const id of handleIds) {
    lines.push(`  - ${id}`);
  }
  lines.push('');

  // polly#107 H5 verification (v0.58.0). The mesh-client side stamps
  // its observed module id at createMeshClient time; every consumer
  // subtree we re-export OBSERVED_MESH_STATE_MODULE_ID_* from gives
  // us its own static-import view. Any divergence proves the SPA
  // bundle resolved @fairfox/polly/mesh to more than one instance.
  const moduleDiag = snap?.meshStateModule;
  const clientSideId = typeof moduleDiag?.moduleId === 'string' ? moduleDiag.moduleId : '(none)';
  const helpViewId = OBSERVED_MESH_STATE_MODULE_ID_FROM_HELPVIEW;
  const usersStateId = OBSERVED_MESH_STATE_MODULE_ID_FROM_USERS_STATE;
  const agendaId = OBSERVED_MESH_STATE_MODULE_ID_FROM_AGENDA;
  const allMatch =
    clientSideId === helpViewId && clientSideId === usersStateId && clientSideId === agendaId;
  lines.push('=== mesh-state module identity (polly#107 H5) ===');
  lines.push(`mesh client side:    ${clientSideId}`);
  lines.push(
    `HelpView side:       ${helpViewId} ${helpViewId === clientSideId ? '(=)' : '(DIFFERENT)'}`
  );
  lines.push(
    `users-state side:    ${usersStateId} ${usersStateId === clientSideId ? '(=)' : '(DIFFERENT)'}`
  );
  lines.push(
    `agenda-state side:   ${agendaId} ${agendaId === clientSideId ? '(=)' : '(DIFFERENT)'}`
  );
  lines.push(
    `verdict:             ${allMatch ? 'all reach one module ← H5 ruled out' : 'DUPLICATION ← H5 confirmed'}`
  );
  if (moduleDiag) {
    lines.push(`configured:          ${moduleDiag.configured === true ? 'yes' : 'NO'}`);
    lines.push(`wasResolved:         ${moduleDiag.wasResolved === true ? 'yes' : 'NO'}`);
    lines.push(`lastConfigRepoPid:   ${moduleDiag.lastConfiguredRepoPeerId ?? '(none)'}`);
    // polly#107 v0.59.0 instrumentation — splits the remaining post-H5
    // ladder: gap between lazyInvocations and lazyReachedRepo localises
    // a throw to the factory body; lastLoadedRejection names the call
    // site; counters equal but repoHandleCount low moves the bug into
    // Automerge's synchroniser layer.
    const inv =
      typeof moduleDiag.lazyInvocations === 'number' ? moduleDiag.lazyInvocations : '(absent)';
    const reached =
      typeof moduleDiag.lazyReachedRepo === 'number' ? moduleDiag.lazyReachedRepo : '(absent)';
    lines.push(`lazyInvocations:     ${inv}    ($mesh* wrapper constructions seen)`);
    lines.push(`lazyReachedRepo:     ${reached} (factory reached repo.handles[docId])`);
    if (typeof inv === 'number' && typeof reached === 'number' && inv > reached) {
      lines.push(
        `  gap:               ${inv - reached} wrapper(s) threw between factory entry and Repo`
      );
    }
    const rej = moduleDiag.lastLoadedRejection;
    if (rej && typeof rej === 'object') {
      lines.push('lastLoadedRejection:');
      lines.push(`  name:              ${rej.name ?? '(no name)'}`);
      lines.push(`  message:           ${rej.message ?? '(no message)'}`);
      lines.push(`  at:                ${rej.at ?? '(no timestamp)'}`);
      if (typeof rej.stack === 'string') {
        const stackLines = rej.stack.split('\n').slice(0, 8);
        for (const sl of stackLines) {
          lines.push(`    ${sl.trim()}`);
        }
      }
    } else {
      lines.push('lastLoadedRejection: (none)');
    }
    // polly#107 v0.61.0 — named failure for storage-layer hangs.
    // Populated within ~5s when buildHandleFactory's `cached.whenReady`
    // or `repo.storageSubsystem.loadDoc` await exceeds the timeout
    // (the IDB-wedge shape that hung this session for three releases).
    const soe = moduleDiag.storageOpenError;
    if (soe && typeof soe === 'object') {
      lines.push(`storageOpenError:    ← polly bounds storage awaits at ${soe.timeoutMs ?? '?'}ms`);
      lines.push(`  operation:         ${soe.operation ?? '(?)'}`);
      lines.push(
        `  documentId:        ${typeof soe.documentId === 'string' ? soe.documentId.slice(0, 12) : '(?)'}`
      );
      lines.push(`  elapsedMs:         ${soe.elapsedMs ?? '?'}`);
      lines.push(`  message:           ${soe.message ?? '(no message)'}`);
    } else {
      lines.push('storageOpenError:    (none — storage layer healthy)');
    }
    // polly#107 v0.60.0 — per-wrapper structured invocation log. One
    // line per $mesh* lazy factory call: which exit path it took
    // (returned-cached / loaded-from-storage / seeded-and-imported /
    // threw), whether the synchronous `repo.handles[docId]` peek in
    // the factory's `finally` block saw the handle registered, and
    // the handle's lifecycle state at that peek.
    const wrappers = Array.isArray(moduleDiag.lazyWrappers) ? moduleDiag.lazyWrappers : [];
    lines.push('');
    lines.push(`lazyWrappers:        ${wrappers.length} record(s) (ring buffer cap 64)`);
    // Summary by exitReason for quick disambiguation.
    const byReason: Record<string, { total: number; registered: number }> = {};
    for (const w of wrappers) {
      const reason = typeof w.exitReason === 'string' ? w.exitReason : '(?)';
      byReason[reason] ??= { total: 0, registered: 0 };
      byReason[reason].total += 1;
      if (w.handleRegistered === true) {
        byReason[reason].registered += 1;
      }
    }
    for (const [reason, stats] of Object.entries(byReason)) {
      lines.push(`  ${reason.padEnd(20, ' ')} total=${stats.total} registered=${stats.registered}`);
    }
    lines.push('  per-record (most recent first):');
    // Reverse so the most recent factory calls show first; ring buffer
    // is FIFO so the tail is the latest.
    const reversed = [...wrappers].reverse();
    for (const w of reversed) {
      const key = typeof w.key === 'string' ? w.key : '(no-key)';
      const docId = typeof w.docId === 'string' ? w.docId.slice(0, 12) : '(no-doc)';
      const reason = typeof w.exitReason === 'string' ? w.exitReason : '(?)';
      const reg = w.handleRegistered === true ? 'yes' : 'NO';
      const state = typeof w.handleState === 'string' ? w.handleState : '(none)';
      const err = typeof w.errorMessage === 'string' ? ` err="${w.errorMessage.slice(0, 80)}"` : '';
      lines.push(
        `    ${key.padEnd(20, ' ')} ${docId} ${reason.padEnd(20, ' ')} reg=${reg} state=${state}${err}`
      );
    }
    // polly#107 v0.61.0 — duplicate docId report. Explains every
    // off-by-one between `lazyWrappers.length` and `repoHandleCount`:
    // one entry per DocumentId reached by more than one factory
    // invocation, naming the keys that resolved to it.
    const dupes = Array.isArray(moduleDiag.lazyWrapperDuplicateDocIds)
      ? moduleDiag.lazyWrapperDuplicateDocIds
      : [];
    lines.push(`lazyWrapperDuplicateDocIds: ${dupes.length} entries`);
    for (const d of dupes) {
      const docId = typeof d.docId === 'string' ? d.docId.slice(0, 12) : '(?)';
      const keys = Array.isArray(d.keys) ? d.keys.join(', ') : '(?)';
      lines.push(`    ${docId} keys=[${keys}] records=${d.recordCount ?? '?'}`);
    }
  } else {
    lines.push('(meshStateModule absent from snapshot — polly version older than 0.58.0?)');
  }
  lines.push('');
  lines.push('=== peers ===');
  lines.push(`local peerId:    ${shortId(snap?.localPeerId)}`);
  lines.push(`known in keyring: ${snap?.knownPeerIds?.length ?? '?'}`);
  lines.push(`present in signalling: ${snap?.presentPeerIds?.length ?? '?'}`);
  lines.push('');
  const peers = Array.isArray(snap?.peers) ? snap.peers : [];
  if (peers.length === 0) {
    lines.push('(no peers reported)');
    return lines.join('\n');
  }
  for (const p of peers) {
    lines.push(`peer ${shortId(p.peerId)}`);
    lines.push(`  keyring=${p.knownInKeyring} signalling=${p.presentInSignalling}`);
    if (p.slotInitiationDecision) {
      const d = p.slotInitiationDecision;
      lines.push(
        `  initiate: reason=${d.reason}${d.error ? ` err=${d.error}` : ''} at=${formatAgo(d.at)}`
      );
    }
    if (p.slot) {
      lines.push(
        `  slot: sig=${p.slot.signalingState ?? '(?)'} ice=${p.slot.iceConnectionState} conn=${p.slot.connectionState} dc=${p.slot.dataChannelState}`
      );
      lines.push(
        `        pendingSends=${p.slot.pendingSendCount} pendingRemoteIce=${p.slot.pendingRemoteIceCount}`
      );
      if (p.slot.lastSyncHandshakeAttempt) {
        const h = p.slot.lastSyncHandshakeAttempt;
        lines.push(
          `  handshake: dcOpen=${formatAgo(h.dataChannelOpenedAt)} peerCand=${formatAgo(h.peerCandidateEmittedAt)} firstSend=${formatAgo(h.firstOutboundSendAt)} firstRecv=${formatAgo(h.firstInboundMessageAt)}`
        );
      }
      // polly#107 per-handle fingerprint — the load-bearing one.
      // Every entry `state:ready, announcedToPeer:false, in:set` →
      // synchronizer didn't initiate (H1/H3). Every entry
      // `announcedToPeer:false, in:undefined` → docId/shareConfig
      // mismatch (H4/H7). Mixed handle states → polly#106 reopens.
      const handlesMap = p.slot.handles ?? {};
      const handleIds = handlesMap && typeof handlesMap === 'object' ? Object.keys(handlesMap) : [];
      if (handleIds.length === 0) {
        lines.push('  handles: (none reported)');
      } else {
        lines.push(`  handles: ${handleIds.length}`);
        for (const docId of handleIds) {
          const h = handlesMap[docId];
          const announced = h.announcedToPeer === true ? 'yes' : 'NO';
          const outType = h.lastSyncMessageOutType ?? '(none)';
          const outSize = h.lastSyncMessageOutSize ?? '?';
          lines.push(
            `    ${docId.slice(0, 12)} state=${h.state} announced=${announced} out=${formatAgo(h.lastSyncMessageOutAt)}/${outType}/${outSize}b in=${formatAgo(h.lastSyncMessageInAt)}`
          );
        }
      }
      if (p.slot.inFlightSync) {
        const i = p.slot.inFlightSync;
        const sinceMs = i.lastChunkAt ? Math.round(performance.now() - i.lastChunkAt) : null;
        lines.push(
          `  sync: chunks=${i.chunksReceived} bytes=${i.bytesReceived} backlog=${i.applyBacklog} lastChunk=${
            sinceMs === null ? 'never' : `${sinceMs}ms ago`
          }`
        );
      } else {
        lines.push('  sync: (no in-flight)');
      }
      if (p.slot.transport) {
        const t = p.slot.transport;
        const pair = t.selectedCandidatePair;
        if (pair) {
          lines.push(
            `  pair: ${pair.local?.type ?? '?'}→${pair.remote?.type ?? '?'} nominated=${pair.nominated} state=${pair.state} bsSent=${pair.bytesSent ?? '?'} brRecv=${pair.bytesReceived ?? '?'}`
          );
        } else {
          lines.push('  pair: (none selected)');
        }
        if (t.retransmittedPacketsSent !== undefined) {
          lines.push(
            `  retransmits: pkts=${t.retransmittedPacketsSent} bytes=${t.retransmittedBytesSent}`
          );
        }
        if (t.lastDataChannelError) {
          lines.push(`  lastDcError: ${t.lastDataChannelError}`);
        }
      } else {
        lines.push('  transport: (not refreshed yet)');
      }
    } else {
      lines.push('  (no slot — peer-joined but no RTC connection)');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function shortId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0) {
    return '(none)';
  }
  return id.slice(0, 12);
}

function formatAgo(at: unknown): string {
  if (typeof at !== 'number') {
    return '(none)';
  }
  const ms = Math.round(performance.now() - at);
  if (ms < 0) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${ms}ms ago`;
  }
  return `${Math.round(ms / 1000)}s ago`;
}

startSyncDiagnosticsPolling();

void refreshDocSizes();

function DocSizes(): preact.JSX.Element {
  const text = docSizesText.value;
  const lineCount = Math.max(3, text.split('\n').length);
  return (
    <Layout rows="auto auto auto auto" columns="minmax(0, 1fr)" gap="var(--polly-space-sm)">
      <Text as="h2" size="lg" weight="bold">
        Document sizes
      </Text>
      <Text as="p" tone="muted">
        On-disk size of every $meshState document in this device's polly store, summed across
        snapshots and incremental chunks. A doc much larger than a few KB is a candidate for
        compaction — the heavy automerge replay on first peer sync scales with this number.
      </Text>
      <Cluster gap="var(--polly-space-sm)" justify="start">
        <Button
          data-action="help.refresh-doc-sizes"
          tier="secondary"
          size="small"
          label="Refresh"
        />
        {docSizesHasSealed.value ? (
          <Button
            data-action="help.cleanup-sealed-docs"
            tier="secondary"
            color="danger"
            size="small"
            label="Delete sealed docs"
          />
        ) : null}
      </Cluster>
      <Surface variant="sunken">
        <textarea
          readOnly={true}
          rows={lineCount}
          value={text}
          data-action="help.select-all-textarea"
          data-help-snapshot="true"
        />
      </Surface>
    </Layout>
  );
}

function SyncDiagnostics(): preact.JSX.Element {
  const text = peerSnapshot.value;
  const lineCount = Math.max(3, text.split('\n').length);
  return (
    <Layout rows="auto auto auto" columns="minmax(0, 1fr)" gap="var(--polly-space-sm)">
      <Text as="h2" size="lg" weight="bold">
        Sync diagnostics
      </Text>
      <Text as="p" tone="muted">
        Per-peer ICE / data-channel / sync state, polled every 2s from polly's getPeerStateSnapshot
        + refreshAllTransportStats. Use this to see whether bytes are actually traversing the relay
        and whether the apply backlog is draining.
      </Text>
      <Surface variant="sunken">
        <textarea
          readOnly={true}
          rows={lineCount}
          value={text}
          data-action="help.select-all-textarea"
          data-help-snapshot="true"
        />
      </Surface>
    </Layout>
  );
}

// Each help section's body as ordered parts — prose (markdown) and
// code (polly `<Code block>`). Prose carries the inline `code`,
// **bold**, *italic* and lists; commands go in code parts so they
// stay width-bounded on a narrow phone viewport.
const INSTALL_APP_PARTS: readonly HelpPart[] = [
  {
    prose: [
      '**Desktop Chrome / Edge:** when the browser decides the site qualifies, it',
      'fires `beforeinstallprompt` and an "Install fairfox" button appears under this',
      'header. A first visit may not fire it — scroll, click, wait ~30s, or reload once',
      'to nudge it.',
      '',
      "**Safari on macOS or iOS:** Chromium's install event doesn't fire in Safari.",
      'Install via the share menu instead:',
      '',
      '1. Open Safari (not Chrome — iOS only lets Safari install PWAs).',
      '2. Tap the Share button (⬆) in the toolbar.',
      '3. Scroll down in the share sheet and tap "Add to Home Screen" (iOS) or "Add to Dock" (macOS).',
      '4. Name it, tap Add.',
      '',
      'Launching from the home-screen icon opens fairfox in standalone PWA mode, no',
      "browser chrome. The **Reload** button in this page's header substitutes for the",
      'refresh gesture you lose in that mode.',
    ].join('\n'),
  },
];

const INSTALL_CLI_PARTS: readonly HelpPart[] = [
  {
    prose: [
      'The CLI is a full peer — same keyring, same documents as this browser. From a',
      'fresh checkout of the repo:',
    ].join('\n'),
  },
  { code: 'bash scripts/install-cli-local.sh' },
  {
    prose: [
      'Symlinks `~/.local/bin/fairfox` and drops a zsh completion at `~/.zfunc/_fairfox`.',
      "If `~/.local/bin` isn't on your PATH yet, add to your `~/.zshrc`:",
    ].join('\n'),
  },
  {
    code: [
      'export PATH="$HOME/.local/bin:$PATH"',
      'fpath=($HOME/.zfunc $fpath)',
      'autoload -U compinit && compinit',
    ].join('\n'),
  },
];

const START_MESH_PARTS: readonly HelpPart[] = [
  {
    code: [
      'fairfox init "Holm household" \\',
      '  --admin "Alex" \\',
      '  --user "Elisa:member" \\',
      '  --user "Leo:member"',
    ].join('\n'),
  },
  {
    prose: [
      'Creates the mesh, prints your recovery blob (save it — password manager), names',
      'the mesh from the first positional argument, and queues one invite blob per',
      '`--user`. Roles: `admin`, `member`, `guest`, `llm`.',
    ].join('\n'),
  },
];

const ADD_DEVICE_PARTS: readonly HelpPart[] = [
  { code: 'fairfox add device' },
  {
    prose: [
      'Terminal QR + share URL. Scan on your phone — the URL carries a pair token and',
      'your recovery blob, so the phone pairs and adopts your identity in one tap. The',
      'URL carries your secret key — share only with yourself.',
    ].join('\n'),
  },
];

const ONBOARD_PARTS: readonly HelpPart[] = [
  { code: 'fairfox add user elisa --role member' },
  {
    prose: [
      'One verb. Mints a fresh invite blob (or reopens an existing one with the same',
      "name), writes the invitee's UserEntry into `mesh:users`, and holds a live QR open",
      'until they scan or you ctrl-c. `fairfox invites` shows pending and consumed',
      'invites; pass `--queue-only` if you want to mint without opening the socket.',
      '',
      'The invitee has three ways to feed the QR into their already-installed PWA, all',
      'behind **"I have a pairing link" → "Paste token"**: tap *Scan with camera* to',
      'open an in-app camera (the OS camera would otherwise launch the default browser,',
      'not the PWA), click the dashed *Scan from a screenshot* zone to pick an image',
      "file, or just Cmd/Ctrl-V an image that's already on the clipboard. All three feed",
      'the same decode pipeline as the text paste box.',
    ].join('\n'),
  },
];

const RECEIVE_PARTS: readonly HelpPart[] = [
  { code: 'fairfox pair <token-or-url-or-blob>' },
  {
    prose: [
      'The receiving side of every onboarding flow — sniffs the input and routes to the',
      'right handler. Use this on a fresh CLI install with a share URL someone else',
      'generated, or with a recovery blob to reclaim your identity.',
    ].join('\n'),
  },
];

const VERIFY_PARTS: readonly HelpPart[] = [
  { code: 'fairfox fingerprint' },
  {
    prose: [
      'Prints the 8-hex mesh fingerprint — same value the Diagnostics panel above shows.',
      'Two devices on the same mesh print the same line; a different mesh prints a',
      'different one.',
    ].join('\n'),
  },
];

const EVERYDAY_PARTS: readonly HelpPart[] = [
  {
    code: [
      '# Todos — same data as the Todo sub-app',
      'fairfox todo tasks',
      'fairfox todo task add "Do the thing" --project P01 --priority high',
      'fairfox todo task done T1776614638630-x33y',
      '',
      '# Agenda',
      'fairfox agenda list',
      'fairfox agenda add "Take out the bins"',
      '',
      '# Identity',
      'fairfox whoami                       # this device + effective perms',
      'fairfox users                        # everyone in the mesh',
      'fairfox add user Leo --role member   # invite a new user',
      '',
      '# Peers + devices',
      'fairfox peers                        # every paired device',
      'fairfox rename "Alex laptop"         # rename this device',
      'fairfox forget <peerId>              # stop syncing with a peer (local)',
      '',
      '# Universal flags on every command',
      'fairfox <command> --help             # detailed help',
      'fairfox <command> --verbose          # debug output to stderr',
      '',
      '# Deploy (from the repo root)',
      'fairfox deploy',
    ].join('\n'),
  },
];

const FILES_PARTS: readonly HelpPart[] = [
  {
    prose: [
      '- `~/.fairfox/keyring.json` — per-device Ed25519 keypair + known peers.',
      '- `~/.fairfox/user-identity.json` — per-user Ed25519 keypair + display name. Mode 0600.',
      '- `~/.fairfox/invites.json` — pending invite blobs. Mode 0600.',
      "- `~/.fairfox/mesh/` — this CLI's Automerge document store. Safe to delete; re-syncs from any other peer.",
    ].join('\n'),
  },
];

const TROUBLESHOOTING_PARTS: readonly HelpPart[] = [
  {
    prose: [
      '- **"This device isn\'t allowed to bring in new peers."** Hard-reload (⇧⌘R); the self-heal writes the missing row on mount. If it persists, re-scan with `fairfox mesh add-device`.',
      '- **Install button not showing.** Desktop Chrome needs a user engagement signal before `beforeinstallprompt` fires. Scroll / click / wait ~30s, then reload. Safari: use the share menu → "Add to Dock" / "Add to Home Screen".',
      '- **CLI crashes with "Cycle detected."** Polly bug fixed in 0.29.3 — make sure `bun install` has picked it up.',
    ].join('\n'),
  },
];

export function HelpView(): preact.JSX.Element {
  return (
    <Layout rows="auto" columns="minmax(0, 1fr)" gap="var(--polly-space-xl)">
      <Diagnostics />
      <DocSizes />
      <SyncDiagnostics />
      <Text as="p">
        fairfox is a small household mesh. Every paired device shares the same CRDT state — todos,
        agenda, users, peers — over WebRTC. The server is only here for discovery and a one-shot
        pairing relay, not the data path. This page is a quick tour of the moving parts.
      </Text>

      <Section heading="Install fairfox as an app" parts={INSTALL_APP_PARTS} />
      <Section heading="Install the CLI" parts={INSTALL_CLI_PARTS} />
      <Section heading="Start a new mesh" parts={START_MESH_PARTS} />
      <Section heading="Add another device for yourself" parts={ADD_DEVICE_PARTS} />
      <Section heading="Onboard someone else" parts={ONBOARD_PARTS} />
      <Section heading="Receive a pair token, share URL, or recovery blob" parts={RECEIVE_PARTS} />
      <Section heading="Verify two devices are on the same mesh" parts={VERIFY_PARTS} />
      <Section heading="Everyday commands" parts={EVERYDAY_PARTS} />
      <Section heading="Files the CLI writes" parts={FILES_PARTS} />
      <Section heading="Troubleshooting" parts={TROUBLESHOOTING_PARTS} />
    </Layout>
  );
}
