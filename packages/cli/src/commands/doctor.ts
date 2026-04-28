// `fairfox doctor` — single command that splits the diagnostic
// space when chat traffic isn't flowing. Replaces the back-and-forth
// of "ssh into the laptop", "pgrep", "fairfox chat dump", "is your
// keyring set up?". Reads — never writes — and never runs the
// chat:main migration wipe (`openChatDoc` is destructive on old
// shapes, so this command sidesteps it and reports the raw shape
// instead).
//
// One paste, all five hypotheses split:
//   (a) chat serve not running          → process check + chat:health relays
//   (b) running but old version / error → chat:health version + lastError*
//   (c) phone → laptop sync broken      → chat:main shape + recent pendings
//   (d) pickNextPending excludes        → annotated state on each user message
//   (e) reply written but didn't sync   → assistant messages with parentIds

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import {
  CHAT_HEALTH_DOC_ID,
  CHAT_HEALTH_INITIAL,
  type ChatHealth,
  LEADER_LEASE_DOC_ID,
  type LeaderLease,
} from '@fairfox/shared/assistant-state';
import type { DevicesDoc } from '@fairfox/shared/devices-state';
import { $meshState, configureMeshState, Repo } from '@fairfox/shared/polly';
import { localVersion } from '#src/commands/update.ts';
import {
  defaultSignalingUrl,
  derivePeerId,
  KEYRING_PATH,
  keyringStorage,
  REPO_STORAGE_PATH,
} from '#src/mesh.ts';
import { loadUserIdentityFile } from '#src/user-identity-node.ts';

interface RawMessage {
  [key: string]: unknown;
  readonly id?: string;
  readonly chatId?: string;
  readonly sender?: string;
  readonly senderUserId?: string;
  readonly senderDeviceId?: string;
  readonly text?: string;
  readonly pending?: boolean;
  readonly parentId?: string;
  readonly createdAt?: string;
  readonly error?: { readonly kind?: string };
}

interface RawChat {
  [key: string]: unknown;
  readonly id?: string;
  readonly title?: string;
  readonly contextRefs?: readonly unknown[];
}

interface RawChatDoc {
  [key: string]: unknown;
  readonly chats?: readonly RawChat[];
  readonly messages?: readonly RawMessage[];
  readonly conversations?: readonly unknown[];
}

const CHAT_MAIN_DOC_ID = 'chat:main';

function shortPeer(p: string | undefined): string {
  return p ? p.slice(0, 8) : '?';
}

function ageOf(iso: string | undefined): string {
  if (!iso) {
    return '(no time)';
  }
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    return iso;
  }
  if (ms < 0) {
    return `${iso} (in future)`;
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s ago`;
  }
  if (ms < 60 * 60_000) {
    return `${Math.round(ms / 60_000)}m ago`;
  }
  if (ms < 24 * 60 * 60_000) {
    return `${Math.round(ms / (60 * 60_000))}h ago`;
  }
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}

function header(title: string): string {
  return `\n=== ${title}\n`;
}

function checkChatServeProcess(): string {
  // Use `ps` directly; macOS pgrep's -a flag exists but emits a
  // different format than GNU pgrep, and we want the full command
  // line so the user can see WHICH version of fairfox is running
  // (a stale pre-doctor relay surfaces as a process whose path
  // points at an old `fairfox.js`).
  try {
    const out = execSync('ps -ax -o pid=,command=', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = out
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          /fairfox/.test(l) &&
          /chat/.test(l) &&
          /serve/.test(l) &&
          !/fairfox\s+doctor/.test(l) &&
          !/grep/.test(l)
      );
    if (lines.length === 0) {
      return 'no `fairfox chat serve` process found on this machine';
    }
    return lines.join('\n');
  } catch (err) {
    return `ps failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function checkSignalingReachable(url: string): Promise<string> {
  // The signalling server speaks WebSocket on /polly/signaling; a
  // plain HTTP probe of /health on the same origin tells us the
  // Bun server is up, which is a useful proxy.
  const httpUrl = url
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/polly\/signaling$/, '/health');
  try {
    const res = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      return `${httpUrl} → ${res.status} ok`;
    }
    return `${httpUrl} → ${res.status} ${res.statusText}`;
  } catch (err) {
    return `${httpUrl} → unreachable (${err instanceof Error ? err.message : String(err)})`;
  }
}

function annotateMessage(msg: RawMessage, allMessages: readonly RawMessage[]): string {
  const sender = msg.sender ?? '?';
  const id = msg.id ?? '?';
  const text = (msg.text ?? '').slice(0, 60).replace(/\n/g, ' ');
  const age = ageOf(msg.createdAt);
  if (sender === 'user') {
    const pending = msg.pending === true;
    const replies = allMessages.filter((m) => m.sender === 'assistant' && m.parentId === id);
    if (pending && replies.length === 0) {
      return `  [PENDING] ${id} · ${age} · ${text}`;
    }
    if (pending && replies.length > 0) {
      return (
        `  [pending=true BUT has reply] ${id} · ${age} · ${text}\n` +
        replies
          .map((r) => `    ↳ ${r.id} ${r.error ? `(error: ${r.error.kind ?? '?'})` : '(ok)'}`)
          .join('\n')
      );
    }
    if (!pending && replies.length === 0) {
      return `  [no-reply, pending cleared] ${id} · ${age} · ${text}`;
    }
    return (
      `  [done] ${id} · ${age} · ${text}\n` +
      replies
        .map((r) => `    ↳ ${r.id} ${r.error ? `(error: ${r.error.kind ?? '?'})` : ''}`)
        .join('\n')
    );
  }
  const errKind = msg.error?.kind;
  return `  [assistant${errKind ? ` error:${errKind}` : ''}] ${id} · parentId=${msg.parentId ?? '?'} · ${age}`;
}

export async function doctor(): Promise<number> {
  const lines: string[] = [];
  lines.push(`fairfox doctor — ${new Date().toISOString()}`);
  lines.push(`CLI version: ${localVersion()}`);
  lines.push(`HOME: ${homedir()}`);
  const fxHome = process.env.FAIRFOX_HOME ?? join(homedir(), '.fairfox');
  lines.push(
    `FAIRFOX_HOME: ${fxHome}${process.env.FAIRFOX_HOME ? ' (set)' : ' (default)'} ${existsSync(fxHome) ? '(present)' : '(missing)'}`
  );
  lines.push(`keyring: ${KEYRING_PATH} ${existsSync(KEYRING_PATH) ? '(present)' : '(missing)'}`);

  lines.push(header('chat serve process'));
  lines.push(checkChatServeProcess());

  const sigUrl = defaultSignalingUrl();
  lines.push(header('signalling server'));
  lines.push(`URL: ${sigUrl}`);
  lines.push(await checkSignalingReachable(sigUrl));

  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    lines.push(header('mesh'));
    lines.push('no keyring on disk — `fairfox mesh init` or pair first');
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }

  const peerId = derivePeerId(keyring.identity.publicKey);
  const identity = loadUserIdentityFile();
  lines.push(header('mesh identity'));
  lines.push(`peerId:    ${peerId}`);
  lines.push(`userId:    ${identity ? identity.userId : '(no user identity)'}`);
  lines.push(`displayName: ${identity?.displayName ?? '(none)'}`);

  // Storage-only Repo: doctor reads the same Automerge docs the
  // running relay does, but joins no signalling network. Without
  // this, opening a real MeshClient would derive the same peerId
  // as the running `chat serve` (peerId comes from the keyring's
  // identity public key) and the signalling server would kick
  // the relay's WebSocket off the moment doctor connects. Storage-
  // only means doctor reflects whatever the relay last persisted
  // to ~/.fairfox/mesh/ on disk, with no live cross-talk.
  const repo = new Repo({
    storage: new NodeFSStorageAdapter(REPO_STORAGE_PATH),
  });
  configureMeshState(repo);
  try {
    lines.push('peers right now: (storage-only doctor — see relay heartbeat for live count)');

    const devicesSignal = $meshState<DevicesDoc>('mesh:devices', { devices: {} });
    await devicesSignal.loaded;
    const allDevices = Object.values(devicesSignal.value.devices);
    lines.push(header(`mesh:devices (${allDevices.length} known)`));
    for (const d of allDevices) {
      const tag = d.peerId === peerId ? ' [self]' : '';
      const owners = (d.ownerUserIds ?? []).map(shortPeer).join(', ') || '(unendorsed)';
      const endorsementCount = (d.endorsements ?? []).length;
      const lastSeen = d.lastSeenAt ? ageOf(d.lastSeenAt) : 'never';
      lines.push(
        `  ${shortPeer(d.peerId)}${tag} · agent=${d.agent} · name=${d.name || '(unnamed)'} · ` +
          `owners=${owners} · endorsements=${endorsementCount} · lastSeen=${lastSeen}`
      );
    }
    const ourRow = devicesSignal.value.devices[peerId];
    const ourEndorsements = ourRow?.endorsements ?? [];
    const ourOwnerIds = ourRow?.ownerUserIds ?? [];
    lines.push(header('mesh:devices self-row'));
    if (ourRow) {
      lines.push(`endorsements: ${ourEndorsements.length}`);
      lines.push(`ownerUserIds: ${ourOwnerIds.map(shortPeer).join(', ') || '(none)'}`);
      const signedByUs = identity && ourEndorsements.some((e) => e.userId === identity.userId);
      lines.push(`signed by our user: ${signedByUs ? 'yes' : 'NO'}`);
    } else {
      lines.push(
        'MISSING — no row for our peerId in mesh:devices. Composer would render null. ' +
          `Either selfHealIdentity hasn't run yet or the IDB hydration is racing.`
      );
    }

    // chat:health — relay state report.
    const healthSignal = $meshState<ChatHealth>(CHAT_HEALTH_DOC_ID, CHAT_HEALTH_INITIAL);
    await healthSignal.loaded;
    lines.push(header('chat:health (relay self-report)'));
    const relays = Object.values(healthSignal.value.relays);
    if (relays.length === 0) {
      lines.push('no relay has ever announced itself on this mesh');
    } else {
      for (const r of relays) {
        const tickAge = ageOf(r.lastTickAt);
        const errBlock = r.lastErrorKind
          ? `\n  last error (${r.lastErrorKind}) ${ageOf(r.lastErrorAt)}: ${r.lastErrorMessage ?? ''}`
          : '';
        const replyBlock = r.lastRepliedAt
          ? `\n  last reply ${ageOf(r.lastRepliedAt)} (id=${r.lastReplyId ?? '?'}, ${r.lastReplyDurationMs ?? '?'}ms)`
          : '';
        const syncSent = r.syncMessagesSent ?? 0;
        const syncRecv = r.syncMessagesReceived ?? 0;
        const docBreakdown = r.syncByDoc
          ? Object.entries(r.syncByDoc)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, c]) => `${name}=${c.rx}/${c.tx}`)
              .join(' ')
          : '';
        const chatMainCounts = r.syncByDoc?.['chat:main'];
        const chatMainSilent =
          chatMainCounts !== undefined && chatMainCounts.rx === 0 && chatMainCounts.tx === 0;
        const chatMainOnlyTx =
          chatMainCounts !== undefined && chatMainCounts.rx === 0 && chatMainCounts.tx > 0;
        const syncBlock =
          syncSent === 0 && syncRecv === 0
            ? '\n  sync: rx=0 tx=0 (NO Automerge sync messages exchanged — peers signalling-paired but data channel silent)'
            : `\n  sync: rx=${syncRecv}${
                r.lastSyncReceivedAt
                  ? ` (last ${ageOf(r.lastSyncReceivedAt)} from ${shortPeer(r.lastSyncFromPeer)})`
                  : ''
              } tx=${syncSent}${
                r.lastSyncSentAt
                  ? ` (last ${ageOf(r.lastSyncSentAt)} to ${shortPeer(r.lastSyncToPeer)})`
                  : ''
              }${docBreakdown ? `\n  per-doc rx/tx: ${docBreakdown}` : ''}${
                chatMainSilent
                  ? '\n  WARNING: chat:main rx=0 tx=0 — peer is connected but not exchanging chat:main ops at all'
                  : chatMainOnlyTx
                    ? '\n  WARNING: chat:main rx=0 — laptop sends but peer never replies for this doc'
                    : ''
              }`;
        lines.push(
          `${shortPeer(r.peerId)} · v${r.version} · started ${ageOf(r.startedAt)} · ` +
            `last tick ${tickAge} · pending ${r.pending} · peers ${r.peers}${
              r.leader ? ' · LEADER' : ''
            }${syncBlock}${replyBlock}${errBlock}`
        );
      }
    }

    // daemon leader lease — independent signal of "did anyone hold
    // the lease recently?", helps disambiguate "no relay" from
    // "relay that never wrote chat:health (older version)".
    const leaseSignal = $meshState<LeaderLease>(LEADER_LEASE_DOC_ID, {
      deviceId: '',
      daemonId: '',
      expiresAt: new Date(0).toISOString(),
      renewedAt: new Date(0).toISOString(),
    });
    await leaseSignal.loaded;
    lines.push(header('daemon:leader lease'));
    const lease = leaseSignal.value;
    if (lease.daemonId) {
      lines.push(`daemonId: ${lease.daemonId.slice(0, 12)} on device ${shortPeer(lease.deviceId)}`);
      lines.push(`expires:  ${lease.expiresAt} (${ageOf(lease.expiresAt)})`);
      lines.push(`renewed:  ${lease.renewedAt} (${ageOf(lease.renewedAt)})`);
    } else {
      lines.push('lease unclaimed (no daemon ever ran)');
    }

    // chat:main — read raw, skip the migration wipe. We DON'T pass
    // through openChatDoc because that would mutate. We use the
    // generic $meshState directly with a permissive shape and
    // diagnose what's there.
    const chatSignal = $meshState<RawChatDoc>(CHAT_MAIN_DOC_ID, {
      chats: [],
      messages: [],
    });
    await chatSignal.loaded;
    const doc = chatSignal.value;
    lines.push(header('chat:main raw shape'));
    const keys = Object.keys(doc);
    lines.push(`keys: ${keys.join(', ')}`);
    if ('conversations' in doc) {
      lines.push(
        `WARNING: legacy "conversations" key present — chat serve startup will wipe this doc on next launch (chat.ts:openChatDoc).`
      );
    }
    const chats = doc.chats ?? [];
    const messages = doc.messages ?? [];
    lines.push(`chats: ${chats.length}, messages: ${messages.length}`);

    const userMsgs = messages.filter((m) => m.sender === 'user');
    const assistantMsgs = messages.filter((m) => m.sender === 'assistant');
    const pendingNoReply = userMsgs.filter(
      (m) => m.pending === true && !assistantMsgs.some((a) => a.parentId === m.id)
    );
    lines.push(
      `user messages: ${userMsgs.length}, assistant: ${assistantMsgs.length}, pending-no-reply: ${pendingNoReply.length}`
    );

    lines.push(header('recent messages (last 10, oldest first)'));
    const recent = [...messages]
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
      .slice(-10);
    for (const m of recent) {
      lines.push(annotateMessage(m, messages));
    }

    if (pendingNoReply.length > 0) {
      lines.push(header('pending-no-reply messages (likely the symptom)'));
      for (const m of pendingNoReply) {
        lines.push(annotateMessage(m, messages));
      }
      lines.push(
        '\nIf any of these is older than 2 minutes AND no relay row above is "live"' +
          " — the relay isn't running. Start `fairfox chat serve` and watch them clear."
      );
    }
  } finally {
    try {
      await repo.shutdown();
    } catch {
      // best-effort
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
