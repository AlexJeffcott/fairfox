// `fairfox chat serve` — long-lived mesh peer that watches the
// `chat:main` $meshState doc for pending user messages and writes
// assistant replies produced by `claude -p`. Idempotent: a user
// message is "handled" when the doc already carries an assistant
// message whose parentId points at it.
//
// Conversations own a list of contextRefs that accumulate as the
// user sends messages from different pages. The relay pulls every
// entry on the conversation's contextRefs list into the prompt.
// History window: messages in the SAME conversation, last 30
// minutes up to the target, capped at 20 entries.

import { $meshState } from '@fairfox/polly/mesh';
import { $ } from 'bun';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '#src/mesh.ts';
import { loadUserIdentityFile } from '#src/user-identity-node.ts';

type Sender = 'user' | 'assistant';
type ContextKind =
  | 'project'
  | 'task'
  | 'tasks-list'
  | 'agenda'
  | 'agenda-today'
  | 'doc'
  | 'docs-list'
  | 'library'
  | 'struggle'
  | 'hub';

interface ContextRef {
  [key: string]: unknown;
  kind: ContextKind;
  id?: string;
  label: string;
  details?: Record<string, unknown>;
}

interface Conversation {
  [key: string]: unknown;
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  contextRefs: ContextRef[];
  archivedAt?: string;
}

interface Message {
  [key: string]: unknown;
  id: string;
  conversationId: string;
  sender: Sender;
  senderUserId: string;
  senderDeviceId: string;
  text: string;
  pending: boolean;
  parentId?: string;
  contextRef?: ContextRef;
  createdAt: string;
}

interface ChatDoc {
  [key: string]: unknown;
  conversations: Conversation[];
  messages: Message[];
}

// Sub-app doc shapes mirrored locally so the CLI doesn't pull in
// their Preact-flavoured modules.
interface MinProject {
  [key: string]: unknown;
  pid: string;
  name: string;
  status: string;
  notes: string;
}
interface MinTask {
  [key: string]: unknown;
  tid: string;
  description: string;
  project: string;
  priority: string;
  done: boolean;
  notes: string;
}
interface MinAgendaItem {
  [key: string]: unknown;
  id: string;
  name: string;
  kind: string;
  recurrence: string;
  room?: string;
  time?: string;
  points: number;
  active: boolean;
}
interface MinAgendaCompletion {
  [key: string]: unknown;
  id: string;
  itemId: string;
  person: string;
  kind: string;
  completedAt: string;
}
interface MinDoc {
  [key: string]: unknown;
  id: string;
  title: string;
  slug: string;
  body: string;
  project: string;
}

const HISTORY_WINDOW_MS = 30 * 60 * 1000;
const HISTORY_MAX = 20;
const POLL_INTERVAL_MS = 5_000;
const CLAUDE_CWD = process.env.RELAY_CWD || process.cwd();

function hasAssistantReply(doc: ChatDoc, userMessageId: string): boolean {
  for (const m of doc.messages) {
    if (m.sender === 'assistant' && m.parentId === userMessageId) {
      return true;
    }
  }
  return false;
}

function pickNextPending(doc: ChatDoc): Message | undefined {
  const pending = doc.messages
    .filter((m) => m.sender === 'user' && m.pending && !hasAssistantReply(doc, m.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return pending[0];
}

function historyFor(doc: ChatDoc, target: Message): Message[] {
  const targetMs = new Date(target.createdAt).getTime();
  const cutoff = targetMs - HISTORY_WINDOW_MS;
  return doc.messages
    .filter((m) => {
      if (m.conversationId !== target.conversationId) {
        return false;
      }
      const ms = new Date(m.createdAt).getTime();
      return ms <= targetMs && ms >= cutoff && m.id !== target.id;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-HISTORY_MAX);
}

function renderHistory(messages: Message[]): string {
  return messages
    .map((m) => {
      const who = m.sender === 'user' ? 'User' : 'Claude';
      return `${who}: ${m.text}`;
    })
    .join('\n\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) {
    return s;
  }
  return `${s.slice(0, n)}\n… (truncated)`;
}

function resolveContext(ref: ContextRef): string {
  try {
    if (ref.kind === 'project') {
      const projects = $meshState<{ projects: MinProject[] }>('todo:projects', { projects: [] });
      const p = projects.value.projects.find((x) => x.pid === ref.id);
      return p ? JSON.stringify(p, null, 2) : `(no project ${ref.id})`;
    }
    if (ref.kind === 'task') {
      const tasks = $meshState<{ tasks: MinTask[] }>('todo:tasks', { tasks: [] });
      const t = tasks.value.tasks.find((x) => x.tid === ref.id);
      return t ? JSON.stringify(t, null, 2) : `(no task ${ref.id})`;
    }
    if (ref.kind === 'tasks-list') {
      const tasks = $meshState<{ tasks: MinTask[] }>('todo:tasks', { tasks: [] });
      const raw = ref.details?.taskIds;
      const ids: string[] = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === 'string')
        : [];
      if (ids.length === 0) {
        return `(tasks-list without ids; summary: ${ref.label})`;
      }
      const matched = tasks.value.tasks.filter((t) => ids.includes(t.tid)).slice(0, 25);
      return JSON.stringify(matched, null, 2);
    }
    if (ref.kind === 'agenda') {
      const agenda = $meshState<{ items: MinAgendaItem[] }>('agenda:main', { items: [] });
      const a = agenda.value.items.find((x) => x.id === ref.id);
      return a ? JSON.stringify(a, null, 2) : `(no agenda item ${ref.id})`;
    }
    if (ref.kind === 'agenda-today') {
      const agenda = $meshState<{
        items: MinAgendaItem[];
        completions: MinAgendaCompletion[];
      }>('agenda:main', { items: [], completions: [] });
      const activeItems = agenda.value.items.filter((i) => i.active);
      return JSON.stringify(activeItems.slice(0, 50), null, 2);
    }
    if (ref.kind === 'doc') {
      const docs = $meshState<{ docs: MinDoc[] }>('docs:main', { docs: [] });
      const d = docs.value.docs.find((x) => x.id === ref.id || x.slug === ref.id);
      if (!d) {
        return `(no doc ${ref.id})`;
      }
      return JSON.stringify({ ...d, body: truncate(d.body, 4000) }, null, 2);
    }
    if (ref.kind === 'docs-list') {
      const docs = $meshState<{ docs: MinDoc[] }>('docs:main', { docs: [] });
      const compact = docs.value.docs.slice(0, 25).map((d) => ({
        id: d.id,
        slug: d.slug,
        title: d.title,
        project: d.project,
      }));
      return JSON.stringify(compact, null, 2);
    }
    if (ref.kind === 'library' || ref.kind === 'struggle' || ref.kind === 'hub') {
      // Coarse-grained views — the label is what the user saw,
      // that's enough signal for the assistant. Deeper resolution
      // lands when / if those sub-apps publish finer contexts.
      return `(view: ${ref.label})`;
    }
  } catch (err) {
    return `(context resolution failed: ${err instanceof Error ? err.message : String(err)})`;
  }
  return '';
}

function conversationContext(doc: ChatDoc, conversationId: string): string {
  const convo = doc.conversations.find((c) => c.id === conversationId);
  if (!convo || convo.contextRefs.length === 0) {
    return '';
  }
  const blocks = convo.contextRefs.map((ref) => {
    const body = resolveContext(ref);
    return `— ${ref.kind}${ref.id ? ` ${ref.id}` : ''} (${ref.label}):\n${body}`;
  });
  return `\n\nContext (conversation-wide):\n${blocks.join('\n\n')}`;
}

function buildPrompt(doc: ChatDoc, target: Message): string {
  const history = renderHistory(historyFor(doc, target));
  const convoContext = conversationContext(doc, target.conversationId);
  const msgContext = target.contextRef
    ? `\n\nMessage-specific context — ${target.contextRef.kind}${target.contextRef.id ? ` ${target.contextRef.id}` : ''}:\n${resolveContext(target.contextRef)}`
    : '';
  return [
    'You are responding in a household chat with multiple family members.',
    'Messages are attributed; the latest user message is the one to answer.',
    'Keep responses concise and practical — readers are likely on a phone.',
    'You have access to the laptop (files, git, commands).',
    convoContext,
    msgContext,
    `\nConversation so far:\n${history}`,
    `\nLatest user message (from ${target.senderUserId.slice(0, 8)}): ${target.text}`,
    '\nRespond. If asked to do something on the laptop, do it and report back briefly.',
  ].join('\n');
}

async function runClaude(prompt: string): Promise<string> {
  // Test hook — when FAIRFOX_CLAUDE_STUB is set the relay short-circuits
  // and returns the env value (or a default echo) instead of shelling out
  // to `claude -p`. This lets scripts/e2e-chat-relay.ts exercise the
  // full write-pending → reply → clear-pending loop without burning API
  // tokens. Never used in production — the env is deliberately
  // unfamiliar and no CI workflow sets it.
  const stub = process.env.FAIRFOX_CLAUDE_STUB;
  if (stub !== undefined) {
    if (stub.length > 0) {
      return stub;
    }
    const peek = prompt.split('\n').at(-2) ?? '';
    return `[stub] acknowledged: ${peek.slice(0, 120)}`;
  }
  const result =
    await $`cd ${CLAUDE_CWD} && claude -p ${prompt} --dangerously-skip-permissions`.text();
  return result.trim();
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function processOne(
  chatSignal: ReturnType<typeof $meshState<ChatDoc>>,
  target: Message,
  selfUserId: string,
  selfPeerId: string
): Promise<void> {
  const prompt = buildPrompt(chatSignal.value, target);
  process.stdout.write(
    `[chat serve] processing ${target.id} (${target.text.slice(0, 60).replace(/\n/g, ' ')}…)\n`
  );
  let replyText: string;
  try {
    replyText = await runClaude(prompt);
  } catch (err) {
    process.stderr.write(
      `[chat serve] claude failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    chatSignal.value = {
      ...chatSignal.value,
      messages: chatSignal.value.messages.map((m) =>
        m.id === target.id ? { ...m, pending: false } : m
      ),
    };
    return;
  }
  const reply: Message = {
    id: randomId(),
    conversationId: target.conversationId,
    sender: 'assistant',
    senderUserId: selfUserId,
    senderDeviceId: selfPeerId,
    text: replyText || '(empty reply)',
    pending: false,
    parentId: target.id,
    createdAt: new Date().toISOString(),
  };
  chatSignal.value = {
    ...chatSignal.value,
    conversations: chatSignal.value.conversations.map((c) =>
      c.id === target.conversationId ? { ...c, updatedAt: reply.createdAt } : c
    ),
    messages: [
      ...chatSignal.value.messages.map((m) => (m.id === target.id ? { ...m, pending: false } : m)),
      reply,
    ],
  };
  process.stdout.write(`[chat serve] replied to ${target.id} (${replyText.length} chars)\n`);
}

/** `fairfox chat send <text>` — writes a pending user message into
 * chat:main. Creates a fresh conversation when there is no active
 * one (the CLI has no notion of "active conversation" the way the
 * widget does, so every invocation starts a new one). Primarily for
 * scripts/e2e-chat-relay.ts, but a useful standalone way to drop a
 * message into the assistant thread from a shell. */
export async function chatSend(text: string): Promise<number> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write('fairfox chat send: no keyring.\n');
    return 1;
  }
  const identity = loadUserIdentityFile();
  if (!identity) {
    process.stderr.write('fairfox chat send: no user identity.\n');
    return 1;
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });
  try {
    const chatSignal = $meshState<ChatDoc>('chat:main', { conversations: [], messages: [] });
    await chatSignal.loaded;
    const now = new Date().toISOString();
    const convo: Conversation = {
      id: randomId(),
      title: text.slice(0, 60),
      createdAt: now,
      updatedAt: now,
      createdByUserId: identity.userId,
      contextRefs: [],
    };
    const message: Message = {
      id: randomId(),
      conversationId: convo.id,
      sender: 'user',
      senderUserId: identity.userId,
      senderDeviceId: peerId,
      text,
      pending: true,
      createdAt: now,
    };
    chatSignal.value = {
      conversations: [...chatSignal.value.conversations, convo],
      messages: [...chatSignal.value.messages, message],
    };
    await flushOutgoing(500);
    process.stdout.write(`wrote message ${message.id} in conversation ${convo.id}\n`);
    return 0;
  } finally {
    try {
      await client.close();
    } catch {
      // best-effort
    }
  }
}

/** `fairfox chat dump` — print chat:main as JSON. Useful after a
 * test run for asserting on message contents; also handy as a plain
 * debugging view. */
export async function chatDump(): Promise<number> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write('fairfox chat dump: no keyring.\n');
    return 1;
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });
  try {
    const chatSignal = $meshState<ChatDoc>('chat:main', { conversations: [], messages: [] });
    await chatSignal.loaded;
    process.stdout.write(`${JSON.stringify(chatSignal.value, null, 2)}\n`);
    return 0;
  } finally {
    try {
      await client.close();
    } catch {
      // best-effort
    }
  }
}

export async function chatServe(): Promise<number> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    process.stderr.write(
      'fairfox chat serve: no keyring — run `fairfox mesh init` or pair first.\n'
    );
    return 1;
  }
  const identity = loadUserIdentityFile();
  if (!identity) {
    process.stderr.write(
      'fairfox chat serve: no user identity. Run `fairfox users bootstrap <name>` or `fairfox users import <blob>` first so replies can be attributed.\n'
    );
    return 1;
  }
  const peerId = derivePeerId(keyring.identity.publicKey);
  const client = await openMeshClient({ peerId });
  process.stdout.write(
    `fairfox chat serve — peerId ${peerId} · userId ${identity.userId.slice(0, 16)}. Ctrl-c to close.\n`
  );

  await waitForPeer(client, 8000);
  const chatSignal = $meshState<ChatDoc>('chat:main', { conversations: [], messages: [] });
  await chatSignal.loaded;
  process.stdout.write(
    `[chat serve] chat:main loaded — ${chatSignal.value.conversations.length} conversation(s), ${chatSignal.value.messages.length} message(s)\n`
  );

  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const next = pickNextPending(chatSignal.value);
      if (next) {
        await processOne(chatSignal, next, identity.userId, peerId);
        await flushOutgoing(1500);
      }
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  const heartbeat = setInterval(() => {
    const peers = client.repo.peers.length;
    const msgs = chatSignal.value.messages;
    const pending = msgs.filter(
      (m) => m.sender === 'user' && m.pending && !hasAssistantReply(chatSignal.value, m.id)
    ).length;
    const now = new Date().toISOString().slice(11, 19);
    process.stdout.write(
      `[${now}] peers=${peers} convos=${chatSignal.value.conversations.length} messages=${msgs.length} pending=${pending}\n`
    );
  }, 10_000);
  void tick();

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  clearInterval(interval);
  clearInterval(heartbeat);
  process.stdout.write('\nchat serve: closing.\n');
  try {
    await flushOutgoing(2000);
  } catch {
    // best-effort
  }
  await client.close();
  return 0;
}
