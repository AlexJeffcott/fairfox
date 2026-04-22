// `fairfox chat serve` — long-lived mesh peer that watches the
// `chat:main` $meshState doc for pending user messages and writes
// assistant replies produced by `claude -p`. Idempotent: a user
// message is considered "already handled" when the doc already
// carries an assistant message whose parentId points at it. CRDT
// replay of old pending flags therefore can't cause double replies.
//
// Each user message carries an optional `contextRef = { kind, id }`.
// When set, the relay fetches the relevant mesh doc (todo:projects,
// todo:tasks, agenda:main, docs:main) and serialises the matching
// entry into the prompt so the assistant sees what was referenced.
//
// History window: messages in the last 30 minutes up to the user's
// message, capped at 20 entries. Earlier exchanges on different
// topics therefore don't pollute a new context.

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
type ContextKind = 'project' | 'task' | 'agenda' | 'doc';

interface ContextRef {
  [key: string]: unknown;
  kind: ContextKind;
  id: string;
}

interface Message {
  [key: string]: unknown;
  id: string;
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
  messages: Message[];
}

// Duplicated context-target shapes — the CLI mirrors the sub-app
// types to stay independent of their Preact-flavoured modules.
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
    if (ref.kind === 'agenda') {
      const agenda = $meshState<{ items: MinAgendaItem[] }>('agenda:main', { items: [] });
      const a = agenda.value.items.find((x) => x.id === ref.id);
      return a ? JSON.stringify(a, null, 2) : `(no agenda item ${ref.id})`;
    }
    if (ref.kind === 'doc') {
      const docs = $meshState<{ docs: MinDoc[] }>('docs:main', { docs: [] });
      const d = docs.value.docs.find((x) => x.id === ref.id || x.slug === ref.id);
      if (!d) {
        return `(no doc ${ref.id})`;
      }
      // A full body can be huge; cap it so the prompt stays focused.
      const body = d.body.length > 4000 ? `${d.body.slice(0, 4000)}\n… (truncated)` : d.body;
      return JSON.stringify({ ...d, body }, null, 2);
    }
  } catch (err) {
    return `(context resolution failed: ${err instanceof Error ? err.message : String(err)})`;
  }
  return '';
}

function buildPrompt(doc: ChatDoc, target: Message): string {
  const history = renderHistory(historyFor(doc, target));
  const contextBlock = target.contextRef
    ? `\n\nContext — ${target.contextRef.kind} ${target.contextRef.id}:\n${resolveContext(target.contextRef)}`
    : '';
  return [
    'You are responding in a household chat with multiple family members.',
    'Messages are attributed; the latest user message is the one to answer.',
    'Keep responses concise and practical — readers are likely on a phone.',
    'You have access to the laptop (files, git, commands).',
    contextBlock,
    `\nConversation so far:\n${history}`,
    `\nLatest user message (from ${target.senderUserId.slice(0, 8)}): ${target.text}`,
    '\nRespond. If asked to do something on the laptop, do it and report back briefly.',
  ].join('\n');
}

async function runClaude(prompt: string): Promise<string> {
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
    // Flip pending off so we don't re-attempt indefinitely; the user
    // can re-send if they want another try.
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
    messages: [
      ...chatSignal.value.messages.map((m) => (m.id === target.id ? { ...m, pending: false } : m)),
      reply,
    ],
  };
  process.stdout.write(`[chat serve] replied to ${target.id} (${replyText.length} chars)\n`);
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
  const chatSignal = $meshState<ChatDoc>('chat:main', { messages: [] });
  await chatSignal.loaded;

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
        // Poke flush so the reply reaches peers promptly.
        await flushOutgoing(1500);
      }
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  // Kick an immediate pass so we don't wait for the first interval
  // if there's already a pending message on connect.
  void tick();

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  clearInterval(interval);
  process.stdout.write('\nchat serve: closing.\n');
  try {
    await flushOutgoing(2000);
  } catch {
    // best-effort
  }
  await client.close();
  return 0;
}
