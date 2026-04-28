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
import {
  CHAT_HEALTH_DOC_ID,
  CHAT_HEALTH_INITIAL,
  type ChatHealth,
  LEADER_LEASE_DOC_ID,
  type LeaderLease,
} from '@fairfox/shared/assistant-state';
import { devicesState } from '@fairfox/shared/devices-state';
import { $meshState } from '@fairfox/shared/polly';
import { localVersion } from '#src/commands/update.ts';
import {
  defaultSignalingUrl,
  derivePeerId,
  KEYRING_PATH,
  keyringStorage,
  openMeshClient,
  waitForPeer,
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
  // pgrep is BSD on macOS, GNU on Linux. -fa works on both.
  try {
    const out = execSync('pgrep -fa "fairfox.*chat.*serve" || true', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = out
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          // Strip the doctor command itself + the pgrep launcher.
          !/fairfox\s+doctor/.test(l) &&
          !/pgrep/.test(l)
      );
    if (lines.length === 0) {
      return 'no `fairfox chat serve` process found on this machine';
    }
    return lines.join('\n');
  } catch (err) {
    return `pgrep failed: ${err instanceof Error ? err.message : String(err)}`;
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
  lines.push(`keyring: ${KEYRING_PATH} ${existsSync(KEYRING_PATH) ? '(present)' : '(missing)'}`);
  const idDir = join(homedir(), '.fairfox');
  lines.push(`fairfox dir: ${idDir} ${existsSync(idDir) ? '(present)' : '(missing)'}`);

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

  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 6000);
    lines.push(
      `peers right now: ${client.repo.peers.length} ${peered ? '' : '(no peers within 6s)'}`
    );

    await devicesState.loaded;
    const ourRow = devicesState.value.devices[peerId];
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
        lines.push(
          `${shortPeer(r.peerId)} · v${r.version} · started ${ageOf(r.startedAt)} · ` +
            `last tick ${tickAge} · pending ${r.pending} · peers ${r.peers}${
              r.leader ? ' · LEADER' : ''
            }${replyBlock}${errBlock}`
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
      await client.close();
    } catch {
      // best-effort
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
