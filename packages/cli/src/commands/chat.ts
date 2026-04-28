// `fairfox chat serve` — long-lived mesh peer that watches the
// `chat:main` $meshState doc for pending user messages and writes
// assistant replies produced by `@anthropic-ai/claude-agent-sdk`.
// Idempotent: a user message is "handled" when the doc already
// carries an assistant message whose parentId points at it.
//
// Chats own a list of contextRefs that accumulate as the user sends
// messages from different pages. The relay pulls every entry on the
// chat's contextRefs list into the prompt. History window: messages
// in the SAME chat, last 30 minutes up to the target, capped at 20
// entries.
//
// Per-turn model routing: `pickModel` picks Sonnet by default, Opus
// for long or thinking-triggered prompts, Haiku for short / quick
// turns. A chat's `pinnedModel` (set from the widget) always wins.
// Usage (tokens, cost) is recorded on the assistant message's extras
// block so the UI can show a per-message badge and a rolling chat
// total.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  AssistantMessageExtras,
  ChatExtras,
  ChatHealth,
  LeaderLease,
  ModelId,
  RelayHealth,
  TurnError,
} from '@fairfox/shared/assistant-state';
import {
  CHAT_HEALTH_DOC_ID,
  CHAT_HEALTH_INITIAL,
  computeCostUsd,
  LEADER_LEASE_DOC_ID,
  parseModelId,
} from '@fairfox/shared/assistant-state';
import { $meshState } from '@fairfox/shared/polly';
import { localVersion } from '#src/commands/update.ts';
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

interface Chat extends ChatExtras {
  [key: string]: unknown;
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  contextRefs: ContextRef[];
  archivedAt?: string;
}

interface Message extends AssistantMessageExtras {
  [key: string]: unknown;
  id: string;
  chatId: string;
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
  chats: Chat[];
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
const RELAY_CWD = process.env.RELAY_CWD || process.cwd();
const AGENT_IDLE_TIMEOUT_MS = 60_000;
const THINKING_TRIGGER = /\b(think|plan|design|debug|why|prove)\b/i;
const LONG_PROMPT_CHARS = 500;
const HARD_DEFAULT_MODEL: ModelId = parseModelId('claude-sonnet-4-6');

/** Locate a usable `claude` CLI binary for the Agent SDK.
 *
 * The bundled fairfox CLI ships @anthropic-ai/claude-agent-sdk
 * inside `fairfox.js`, but the SDK depends on a per-platform
 * native binary distributed as an OPTIONAL dependency. If
 * `bun install` ran with `--omit=optional` (or the bundler dropped
 * the platform-specific package the user is on), `query()` throws
 * at first call: "Native CLI binary for darwin-arm64 not found".
 * Every chat turn then writes an `error: unknown` reply and the
 * user sees a thread of broken responses.
 *
 * The user almost certainly has `claude` on their PATH — Claude
 * Code is a near-prerequisite for fairfox in practice. So check
 * for an explicit override, then fall back to `which claude`.
 * Returning undefined lets the SDK try its bundled binary; the
 * resulting error message is now the existing one with a clearer
 * diagnostic in the first chat:health row. */
function findClaudeBinary(): string | undefined {
  const explicit = process.env.FAIRFOX_CLAUDE_PATH;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  try {
    const found = execSync('command -v claude', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (found && existsSync(found)) {
      return found;
    }
  } catch {
    // claude not on PATH; let the SDK fall through to its bundled binary.
  }
  return undefined;
}

const CLAUDE_BINARY = findClaudeBinary();

const LEASE_TTL_MS = 30_000;
const LEASE_RENEW_MS = 10_000;
const STALE_TURN_MS = 2 * 60 * 1000;
const PREFLIGHT_CHARS_PER_USD = 50_000;

function envModel(): ModelId | undefined {
  const raw = process.env.FAIRFOX_ASSISTANT_MODEL;
  if (!raw) {
    return undefined;
  }
  try {
    return parseModelId(raw);
  } catch {
    process.stderr.write(
      `[chat serve] ignoring FAIRFOX_ASSISTANT_MODEL="${raw}" — not a valid claude model id.\n`
    );
    return undefined;
  }
}

function pickModel(chat: Chat | undefined, target: Message): ModelId {
  if (chat?.pinnedModel) {
    return chat.pinnedModel;
  }
  const text = target.text;
  if (text.length < 20) {
    return parseModelId('claude-haiku-4-5');
  }
  if (THINKING_TRIGGER.test(text) || text.length > LONG_PROMPT_CHARS) {
    return parseModelId('claude-opus-4-7');
  }
  return envModel() ?? HARD_DEFAULT_MODEL;
}

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
      if (m.chatId !== target.chatId) {
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

function chatContext(doc: ChatDoc, chatId: string): string {
  const chat = doc.chats.find((c) => c.id === chatId);
  if (!chat || chat.contextRefs.length === 0) {
    return '';
  }
  const blocks = chat.contextRefs.map((ref) => {
    const body = resolveContext(ref);
    return `— ${ref.kind}${ref.id ? ` ${ref.id}` : ''} (${ref.label}):\n${body}`;
  });
  return `\n\nContext (chat-wide):\n${blocks.join('\n\n')}`;
}

function buildPrompt(doc: ChatDoc, target: Message): string {
  const history = renderHistory(historyFor(doc, target));
  const ctxBlock = chatContext(doc, target.chatId);
  const msgContext = target.contextRef
    ? `\n\nMessage-specific context — ${target.contextRef.kind}${target.contextRef.id ? ` ${target.contextRef.id}` : ''}:\n${resolveContext(target.contextRef)}`
    : '';
  return [
    'You are responding in a household chat with multiple family members.',
    'Messages are attributed; the latest user message is the one to answer.',
    'Keep responses concise and practical — readers are likely on a phone.',
    'You have access to the laptop (files, git, commands).',
    ctxBlock,
    msgContext,
    `\nChat so far:\n${history}`,
    `\nLatest user message (from ${target.senderUserId.slice(0, 8)}): ${target.text}`,
    '\nRespond. If asked to do something on the laptop, do it and report back briefly.',
  ].join('\n');
}

interface AgentResult {
  readonly text: string;
  readonly extras: AssistantMessageExtras;
}

async function runAgent(prompt: string, model: ModelId, startedAt: string): Promise<AgentResult> {
  // Test hook — when FAIRFOX_CLAUDE_STUB is set the relay
  // short-circuits and returns the env value (or a default echo)
  // instead of calling the Agent SDK. This lets
  // scripts/e2e-chat-relay.ts exercise the pending → reply → clear
  // loop without burning API tokens. Never used in production —
  // the env is deliberately unfamiliar and no CI workflow sets it.
  const stub = process.env.FAIRFOX_CLAUDE_STUB;
  if (stub !== undefined) {
    const text = stub.length > 0 ? stub : `[stub] acknowledged: ${prompt.split('\n').at(-2) ?? ''}`;
    return {
      text,
      extras: {
        model,
        startedAt,
        finishedAt: new Date().toISOString(),
      },
    };
  }

  const abort = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => abort.abort(), AGENT_IDLE_TIMEOUT_MS);
  };
  resetIdleTimer();

  let text = '';
  let extras: AssistantMessageExtras = { model, startedAt };
  const toolsUsed: string[] = [];
  try {
    for await (const msg of query({
      prompt,
      options: {
        model,
        cwd: RELAY_CWD,
        abortController: abort,
        ...(CLAUDE_BINARY ? { pathToClaudeCodeExecutable: CLAUDE_BINARY } : {}),
        systemPrompt: [
          'You are the fairfox household assistant running on the laptop.',
          'The user may be on a phone, iPad, or the laptop itself.',
          'Keep responses concise and practical unless explicitly asked to go deep.',
          'You have access to the laptop (files, git, commands).',
        ].join(' '),
      },
    })) {
      resetIdleTimer();
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
          }
        }
      }
      if (msg.type === 'result') {
        const finishedAt = new Date().toISOString();
        if (msg.subtype === 'success') {
          text = msg.result;
          extras = {
            model,
            startedAt,
            finishedAt,
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            ...(msg.usage.cache_read_input_tokens === undefined
              ? {}
              : { cachedInputTokens: msg.usage.cache_read_input_tokens }),
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
          };
        } else {
          const firstError = msg.errors[0] ?? '';
          const isAuth = /401|403|auth|api.key|unauthorized/i.test(firstError);
          const err: TurnError = isAuth
            ? { kind: 'no-api-key', message: firstError || 'authentication failed' }
            : {
                kind: 'api',
                status: 0,
                message: firstError || `agent: ${msg.subtype}`,
              };
          extras = {
            model,
            startedAt,
            finishedAt,
            durationMs: msg.duration_ms,
            error: err,
          };
        }
      }
    }
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const aborted = abort.signal.aborted;
    const turnError: TurnError = aborted
      ? { kind: 'timeout', idleMs: AGENT_IDLE_TIMEOUT_MS }
      : { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
    extras = { model, startedAt, finishedAt, error: turnError };
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
  }
  return { text, extras };
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthCostSoFar(doc: ChatDoc, currentMonth: string): number {
  let total = 0;
  for (const m of doc.messages) {
    if (m.sender !== 'assistant' || typeof m.costUsd !== 'number') {
      continue;
    }
    if (monthKey(m.createdAt) === currentMonth) {
      total += m.costUsd;
    }
  }
  return total;
}

function estimatedUsdForTurn(prompt: string, model: ModelId): number {
  // Rough ballpark — divides input chars by a per-dollar budget to
  // get a scale-invariant estimate. The point of the estimator is to
  // flag a warning before a costly turn lands, not to be accurate.
  const factor =
    model === parseModelId('claude-opus-4-7')
      ? 5
      : model === parseModelId('claude-haiku-4-5')
        ? 0.2
        : 1;
  return (prompt.length / PREFLIGHT_CHARS_PER_USD) * factor;
}

function monthlyCostCapUsd(): number | undefined {
  const raw = process.env.FAIRFOX_MONTHLY_COST_CAP_USD;
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Writes a system-style assistant message warning of the pending
 * monthly cap breach. Does not refuse the turn — the user has
 * explicitly set the cap, not asked us to hard-refuse above it. */
function writeCapWarning(
  chatSignal: ReturnType<typeof $meshState<ChatDoc>>,
  chatId: string,
  selfUserId: string,
  selfPeerId: string,
  mtd: number,
  cap: number
): void {
  const nowIso = new Date().toISOString();
  const warning: Message = {
    id: randomId(),
    chatId,
    sender: 'assistant',
    senderUserId: selfUserId,
    senderDeviceId: selfPeerId,
    text: `⚠ Monthly cost cap ($${cap.toFixed(2)}) about to be crossed — MTD $${mtd.toFixed(2)}. Continuing; set FAIRFOX_MONTHLY_COST_CAP_USD higher or pin cheaper models in the widget to silence.`,
    pending: false,
    createdAt: nowIso,
    model: HARD_DEFAULT_MODEL,
    costUsd: 0,
  };
  chatSignal.value = {
    ...chatSignal.value,
    messages: [...chatSignal.value.messages, warning],
  };
}

interface LeaderContext {
  readonly daemonId: string;
  readonly deviceId: string;
}

/** Try to claim the `daemon:leader` lease. Returns a `release()`
 * handle on success. If another daemon currently holds a live
 * lease, returns null — caller should sit out and re-check later.
 * The lease is 30 s; renewed every 10 s. */
function tryAcquireLease(
  leaseSignal: ReturnType<typeof $meshState<LeaderLease>>,
  ctx: LeaderContext
): boolean {
  const nowMs = Date.now();
  const current = leaseSignal.value;
  const expiresMs = current.expiresAt ? new Date(current.expiresAt).getTime() : 0;
  const held: boolean = current.daemonId.length > 0 && expiresMs > nowMs;
  const heldBySelf: boolean = held && current.daemonId === ctx.daemonId;
  if (held && !heldBySelf) {
    return false;
  }
  leaseSignal.value = {
    deviceId: ctx.deviceId,
    daemonId: ctx.daemonId,
    expiresAt: new Date(nowMs + LEASE_TTL_MS).toISOString(),
    renewedAt: new Date(nowMs).toISOString(),
  };
  return true;
}

function releaseLease(
  leaseSignal: ReturnType<typeof $meshState<LeaderLease>>,
  ctx: LeaderContext
): void {
  const current = leaseSignal.value;
  if (current.daemonId !== ctx.daemonId) {
    return;
  }
  leaseSignal.value = {
    deviceId: ctx.deviceId,
    daemonId: '',
    expiresAt: new Date(0).toISOString(),
    renewedAt: new Date().toISOString(),
  };
}

/** Mark any pending user message older than STALE_TURN_MS — or
 * whose last reply came from a different daemon session — with a
 * `daemon-restarted` error so the widget can surface a regenerate
 * affordance instead of a forever-spinning indicator. Runs once on
 * daemon startup. */
function sweepStaleTurns(
  chatSignal: ReturnType<typeof $meshState<ChatDoc>>,
  selfUserId: string,
  selfPeerId: string,
  ourDaemonId: string
): number {
  const nowMs = Date.now();
  const cutoff = nowMs - STALE_TURN_MS;
  const toMark: Message[] = [];
  for (const m of chatSignal.value.messages) {
    if (m.sender !== 'user' || !m.pending) {
      continue;
    }
    if (hasAssistantReply(chatSignal.value, m.id)) {
      continue;
    }
    const startedMs = new Date(m.createdAt).getTime();
    if (startedMs >= cutoff) {
      continue;
    }
    toMark.push(m);
  }
  if (toMark.length === 0) {
    return 0;
  }
  const nowIso = new Date().toISOString();
  const errors: Message[] = toMark.map((m) => ({
    id: randomId(),
    chatId: m.chatId,
    sender: 'assistant',
    senderUserId: selfUserId,
    senderDeviceId: selfPeerId,
    text: '(interrupted — regenerate to retry)',
    pending: false,
    parentId: m.id,
    createdAt: nowIso,
    model: HARD_DEFAULT_MODEL,
    startedAt: m.createdAt,
    finishedAt: nowIso,
    error: { kind: 'daemon-restarted', message: `recovered on daemon ${ourDaemonId}` },
    daemonId: selfPeerId,
    costUsd: 0,
  }));
  chatSignal.value = {
    ...chatSignal.value,
    messages: [
      ...chatSignal.value.messages.map((m) =>
        toMark.some((t) => t.id === m.id) ? { ...m, pending: false } : m
      ),
      ...errors,
    ],
  };
  return toMark.length;
}

function findChat(doc: ChatDoc, chatId: string): Chat | undefined {
  return doc.chats.find((c) => c.id === chatId);
}

interface ProcessResult {
  readonly replyId: string;
  readonly replyAt: string;
  readonly durationMs: number;
  readonly error?: TurnError;
}

async function processOne(
  chatSignal: ReturnType<typeof $meshState<ChatDoc>>,
  target: Message,
  selfUserId: string,
  selfPeerId: string
): Promise<ProcessResult> {
  const prompt = buildPrompt(chatSignal.value, target);
  const model = pickModel(findChat(chatSignal.value, target.chatId), target);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  process.stdout.write(
    `[chat serve] processing ${target.id} via ${model} (${target.text.slice(0, 60).replace(/\n/g, ' ')}…)\n`
  );
  const { text: replyText, extras } = await runAgent(prompt, model, startedAt);
  const finalCost =
    extras.costUsd ??
    computeCostUsd({
      model: extras.model,
      inputTokens: extras.inputTokens,
      outputTokens: extras.outputTokens,
      cachedInputTokens: extras.cachedInputTokens,
    });
  const reply: Message = {
    id: randomId(),
    chatId: target.chatId,
    sender: 'assistant',
    senderUserId: selfUserId,
    senderDeviceId: selfPeerId,
    text: replyText || (extras.error ? `(error: ${extras.error.kind})` : '(empty reply)'),
    pending: false,
    parentId: target.id,
    createdAt: new Date().toISOString(),
    ...extras,
    costUsd: finalCost,
    daemonId: selfPeerId,
  };
  chatSignal.value = {
    ...chatSignal.value,
    chats: chatSignal.value.chats.map((c) =>
      c.id === target.chatId
        ? {
            ...c,
            updatedAt: reply.createdAt,
            totalCostUsd: Math.round(((c.totalCostUsd ?? 0) + finalCost) * 10_000) / 10_000,
            typing: false,
          }
        : c
    ),
    messages: [
      ...chatSignal.value.messages.map((m) => (m.id === target.id ? { ...m, pending: false } : m)),
      reply,
    ],
  };
  process.stdout.write(
    `[chat serve] replied to ${target.id} (${replyText.length} chars · $${finalCost.toFixed(4)})\n`
  );
  return {
    replyId: reply.id,
    replyAt: reply.createdAt,
    durationMs: Date.now() - startedMs,
    error: extras.error,
  };
}

/** Open `chat:main` and clean up a pre-rename shape. Older meshes
 * (and the brief CLI-only window before the widget shipped) used
 * `{ conversations, messages }` with `Message.conversationId`.
 *
 * Two failure modes the previous "wipe to empty" pass missed:
 *
 * 1. Setting `signal.value = { chats: [], messages: [] }` does NOT
 *    delete the legacy `conversations` key from the underlying
 *    Automerge doc — polly's applyTopLevel only iterates the
 *    incoming value's keys. So the wipe condition stayed true
 *    forever and every relay restart kept nuking the doc on each
 *    boot, including any in-flight pendings.
 *
 * 2. Wiping `messages` indiscriminately threw away pendings the
 *    user had just written. We only need to drop messages whose
 *    `conversationId` field shows the legacy shape; new-shape
 *    messages can stay.
 *
 * The fix uses handle.change to delete the legacy keys at the
 * Automerge level (real key removal, propagates to peers as a
 * delete op), and only filters out messages with the legacy
 * `conversationId` field while preserving everything else. */
async function openChatDoc(): Promise<ReturnType<typeof $meshState<ChatDoc>>> {
  const chatSignal = $meshState<ChatDoc>('chat:main', { chats: [], messages: [] });
  await chatSignal.loaded;
  const v = chatSignal.value as unknown as Record<string, unknown>;
  const handle = chatSignal.handle;
  if (!handle) {
    return chatSignal;
  }
  const hasLegacyKey = v.conversations !== undefined;
  const messagesField = v.messages;
  const hasLegacyMessages =
    Array.isArray(messagesField) &&
    messagesField.some(
      (m): boolean =>
        typeof m === 'object' &&
        m !== null &&
        'conversationId' in m &&
        (m as unknown as Record<string, unknown>).conversationId !== undefined
    );
  const hasMissingFields = v.chats === undefined || v.messages === undefined;
  if (!hasLegacyKey && !hasLegacyMessages && !hasMissingFields) {
    return chatSignal;
  }
  handle.change((doc: Record<string, unknown>) => {
    if (doc.conversations !== undefined) {
      delete doc.conversations;
    }
    if (doc.chats === undefined) {
      doc.chats = [];
    }
    if (doc.messages === undefined) {
      doc.messages = [];
    } else if (Array.isArray(doc.messages) && hasLegacyMessages) {
      doc.messages = doc.messages.filter(
        (m: unknown): boolean =>
          typeof m === 'object' &&
          m !== null &&
          !(
            'conversationId' in m &&
            (m as unknown as Record<string, unknown>).conversationId !== undefined
          )
      );
    }
  });
  await flushOutgoing(500);
  return chatSignal;
}

/** `fairfox chat send <text>` — writes a pending user message into
 * chat:main. Creates a fresh chat when there is no active one (the
 * CLI has no notion of "active chat" the way the widget does, so
 * every invocation starts a new one). Primarily for
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
    await waitForPeer(client, 8000);
    const chatSignal = await openChatDoc();
    const now = new Date().toISOString();
    const chat: Chat = {
      id: randomId(),
      title: text.slice(0, 60),
      createdAt: now,
      updatedAt: now,
      createdByUserId: identity.userId,
      contextRefs: [],
    };
    const message: Message = {
      id: randomId(),
      chatId: chat.id,
      sender: 'user',
      senderUserId: identity.userId,
      senderDeviceId: peerId,
      text,
      pending: true,
      createdAt: now,
    };
    chatSignal.value = {
      chats: [...chatSignal.value.chats, chat],
      messages: [...chatSignal.value.messages, message],
    };
    await flushOutgoing(2500);
    process.stdout.write(`wrote message ${message.id} in chat ${chat.id}\n`);
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
    const chatSignal = await openChatDoc();
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
  if (CLAUDE_BINARY) {
    process.stdout.write(`[chat serve] claude binary: ${CLAUDE_BINARY}\n`);
  } else {
    process.stdout.write(
      '[chat serve] WARNING: no `claude` binary found on PATH; SDK will use its bundled native binary or fail. Set FAIRFOX_CLAUDE_PATH if needed.\n'
    );
  }

  await waitForPeer(client, 8000);
  const chatSignal = await openChatDoc();
  process.stdout.write(
    `[chat serve] chat:main loaded — ${chatSignal.value.chats.length} chat(s), ${chatSignal.value.messages.length} message(s)\n`
  );

  const leaseSignal = $meshState<LeaderLease>(LEADER_LEASE_DOC_ID, {
    deviceId: '',
    daemonId: '',
    expiresAt: new Date(0).toISOString(),
    renewedAt: new Date(0).toISOString(),
  });
  await leaseSignal.loaded;
  const daemonId = randomId();
  const leaderCtx: LeaderContext = { daemonId, deviceId: peerId };

  // chat:health — self-reported relay state. Every running relay
  // upserts its own row keyed by peerId on each heartbeat tick. The
  // widget reads this doc and renders a "relay live / stale / none"
  // badge so the user can see at a glance whether their laptop is
  // ready to reply, without having to ssh in and pgrep. A crashed
  // relay leaves a stale row; a manual `fairfox chat clear-health`
  // could prune it later, but stale-with-old-lastTickAt is more
  // informative than missing.
  const healthSignal = $meshState<ChatHealth>(CHAT_HEALTH_DOC_ID, CHAT_HEALTH_INITIAL);
  await healthSignal.loaded;
  const startedAt = new Date().toISOString();
  const cliVersion = localVersion();

  function writeHealth(patch: Partial<RelayHealth>): void {
    const prev: RelayHealth = healthSignal.value.relays[peerId] ?? {
      peerId,
      daemonId,
      version: cliVersion,
      startedAt,
      lastTickAt: startedAt,
      peers: 0,
      pending: 0,
      chats: 0,
      messages: 0,
      leader: false,
    };
    const next: RelayHealth = { ...prev, ...patch, peerId, daemonId, version: cliVersion };
    healthSignal.value = {
      ...healthSignal.value,
      relays: { ...healthSignal.value.relays, [peerId]: next },
    };
  }
  writeHealth({ startedAt, lastTickAt: startedAt });

  // Sync telemetry — listen to the Repo's doc-metrics events so the
  // heartbeat can report whether Automerge sync messages are
  // actually flowing across the WebRTC data channel. peers=1 from
  // the network adapter only means signalling matched us with a
  // peer; non-zero sent/received counters prove the channel is
  // alive and exchanging ops. Most useful when you're chasing
  // "the laptop sees the phone but the phone's writes never
  // arrive": if received counter stays at 0 while peers=1, the
  // data channel is broken even though signalling is happy.
  //
  // Per-doc counters split a deeper failure mode: sync flowing in
  // aggregate (rx=10000+) but ZERO ops for chat:main specifically.
  // When that happens, the peers are exchanging data for other
  // docs (mesh:devices, mesh:users, agenda:main) but the chat:main
  // handle on one side is somehow not in the share set with the
  // other peer. A breakdown by docId tells us "everything else
  // syncs, chat:main doesn't."
  let syncSent = 0;
  let syncReceived = 0;
  let lastSyncSentAt: string | undefined;
  let lastSyncReceivedAt: string | undefined;
  let lastSyncFromPeer: string | undefined;
  let lastSyncToPeer: string | undefined;
  const syncByDocId = new Map<string, { rx: number; tx: number }>();
  function bumpDoc(docId: string, dir: 'rx' | 'tx'): void {
    const cur = syncByDocId.get(docId) ?? { rx: 0, tx: 0 };
    cur[dir] += 1;
    syncByDocId.set(docId, cur);
  }
  // Map known logical keys to their docIds via the open handles.
  // We hold chat:main, chat:health, and daemon:leader open here;
  // the other docs (mesh:devices, mesh:users, agenda:main, etc.)
  // get touched by openMeshClient or appear later. The map fills
  // out as we discover new docIds in sync events.
  const docNameById = new Map<string, string>();
  function noteDoc(handle: { documentId?: string } | undefined, name: string): void {
    const id = handle?.documentId;
    if (typeof id === 'string') {
      docNameById.set(id, name);
    }
  }
  noteDoc(chatSignal.handle, 'chat:main');
  noteDoc(healthSignal.handle, 'chat:health');
  noteDoc(leaseSignal.handle, 'daemon:leader');
  client.repo.on('doc-metrics', (m) => {
    const now = new Date().toISOString();
    if (m.type === 'receive-sync-message') {
      syncReceived += 1;
      lastSyncReceivedAt = now;
      lastSyncFromPeer = String(m.fromPeer);
      bumpDoc(String(m.documentId), 'rx');
    } else if (m.type === 'generate-sync-message') {
      syncSent += 1;
      lastSyncSentAt = now;
      lastSyncToPeer = String(m.forPeer);
      bumpDoc(String(m.documentId), 'tx');
    }
  });

  // Startup sweep: mark crashed-mid-turn messages with daemon-restarted
  // so the widget can surface a regenerate affordance instead of
  // leaving the user staring at a forever-pending spinner.
  const swept = sweepStaleTurns(chatSignal, identity.userId, peerId, daemonId);
  if (swept > 0) {
    process.stdout.write(`[chat serve] swept ${swept} stale pending message(s)\n`);
    await flushOutgoing(500);
  }

  const cap = monthlyCostCapUsd();
  if (cap !== undefined) {
    process.stdout.write(`[chat serve] monthly cost cap: $${cap.toFixed(2)}\n`);
  }

  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) {
      return;
    }
    if (!tryAcquireLease(leaseSignal, leaderCtx)) {
      return;
    }
    busy = true;
    try {
      const next = pickNextPending(chatSignal.value);
      if (next) {
        const chat = findChat(chatSignal.value, next.chatId);
        const chosenModel = pickModel(chat, next);
        if (cap !== undefined) {
          const mtd = monthCostSoFar(chatSignal.value, monthKey(next.createdAt));
          const estimate = estimatedUsdForTurn(next.text, chosenModel);
          if (mtd + estimate >= cap) {
            writeCapWarning(chatSignal, next.chatId, identity.userId, peerId, mtd, cap);
            await flushOutgoing(500);
          }
        }
        const result = await processOne(chatSignal, next, identity.userId, peerId);
        if (result.error) {
          writeHealth({
            lastErrorAt: result.replyAt,
            lastErrorKind: result.error.kind,
            lastErrorMessage:
              'message' in result.error && typeof result.error.message === 'string'
                ? result.error.message.slice(0, 200)
                : undefined,
          });
        } else {
          writeHealth({
            lastRepliedAt: result.replyAt,
            lastReplyId: result.replyId,
            lastReplyDurationMs: result.durationMs,
          });
        }
        await flushOutgoing(1500);
      }
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  const leaseRenew = setInterval(() => {
    if (!busy) {
      tryAcquireLease(leaseSignal, leaderCtx);
    }
  }, LEASE_RENEW_MS);
  const heartbeat = setInterval(() => {
    const peers = client.repo.peers.length;
    const msgs = chatSignal.value.messages;
    const pending = msgs.filter(
      (m) => m.sender === 'user' && m.pending && !hasAssistantReply(chatSignal.value, m.id)
    ).length;
    const nowIso = new Date().toISOString();
    const now = nowIso.slice(11, 19);
    const lease = leaseSignal.value;
    const held =
      lease.daemonId === daemonId ? 'self' : lease.daemonId.length > 0 ? 'other' : 'none';
    // Per-doc breakdown inline. Surfaces the failure mode where
    // overall sync is flowing but chat:main has zero ops because
    // the peer hasn't joined that share set.
    const perDoc: string[] = [];
    for (const [docId, counts] of syncByDocId) {
      const name = docNameById.get(docId) ?? docId.slice(0, 8);
      perDoc.push(`${name}=${counts.rx}/${counts.tx}`);
    }
    process.stdout.write(
      `[${now}] peers=${peers} chats=${chatSignal.value.chats.length} messages=${msgs.length} pending=${pending} lease=${held} sync(rx=${syncReceived} tx=${syncSent}) docs[${perDoc.join(' ')}]\n`
    );
    const syncByDocOut: Record<string, { rx: number; tx: number }> = {};
    for (const [docId, counts] of syncByDocId) {
      const name = docNameById.get(docId) ?? docId.slice(0, 12);
      syncByDocOut[name] = { rx: counts.rx, tx: counts.tx };
    }
    writeHealth({
      lastTickAt: nowIso,
      peers,
      pending,
      chats: chatSignal.value.chats.length,
      messages: msgs.length,
      leader: lease.daemonId === daemonId,
      syncMessagesSent: syncSent,
      syncMessagesReceived: syncReceived,
      syncByDoc: syncByDocOut,
      ...(lastSyncSentAt ? { lastSyncSentAt } : {}),
      ...(lastSyncReceivedAt ? { lastSyncReceivedAt } : {}),
      ...(lastSyncFromPeer ? { lastSyncFromPeer } : {}),
      ...(lastSyncToPeer ? { lastSyncToPeer } : {}),
    });
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
  clearInterval(leaseRenew);
  clearInterval(heartbeat);
  releaseLease(leaseSignal, leaderCtx);
  process.stdout.write('\nchat serve: closing.\n');
  try {
    await flushOutgoing(2000);
  } catch {
    // best-effort
  }
  await client.close();
  return 0;
}
