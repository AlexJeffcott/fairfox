// URL-driven view & seed hooks for the chat widget.
//
// Two tiers:
//
//   1. Always-on deep-links — pure view state.
//      ?widget=open       open the widget panel on load
//      #chat=<id>         open the widget to a specific conversation
//      #ctx=<kind>:<id>   pin a context onto the active conversation
//
//   2. Injected demo overlay — also always-on but clearly marked
//      and non-persistent.
//      #__inject=<base64 JSON>
//      { "messages": [...], "conversations": [...], "sessions": [...] }
//
// The inject payload writes to a VIEW-ONLY overlay signal
// (`injectedOverlay` in ./state.ts), never to the mesh docs. That
// means:
//   - Injected items stay on the device that loaded the URL; they
//     do NOT replicate to paired peers.
//   - A reload / navigation wipes them.
//   - The widget renders a persistent banner + a "(demo)" badge
//     on every injected bubble so nothing injected can pass for a
//     real message.
// This preserves the "URL can embellish app data" ergonomic the
// user wants without the phishing / mesh-pollution risks that come
// with writing fakes into Automerge.

import type {
  AssistantMessageExtras,
  ConversationExtras,
  SessionAnnouncement,
} from '@fairfox/shared/assistant-state';
import { toAbsolutePath, toSessionId } from '@fairfox/shared/assistant-state';
import type { PageContext, PageContextKind } from '@fairfox/shared/page-context';
import type { Conversation, Message } from '#src/client/state.ts';
import {
  activeConversationId,
  chatState,
  injectedOverlay,
  pinnedContext,
  sessionsActive,
  widgetOpen,
} from '#src/client/state.ts';

interface InjectPayload {
  readonly messages?: readonly InjectedMessage[];
  readonly conversations?: readonly InjectedConversation[];
  readonly sessions?: readonly InjectedSession[];
}

type InjectedMessage = Partial<Message & AssistantMessageExtras> & {
  readonly id: string;
  readonly conversationId: string;
  readonly sender: 'user' | 'assistant';
};

type InjectedConversation = Partial<Conversation & ConversationExtras> & {
  readonly id: string;
};

type InjectedSession = Partial<SessionAnnouncement> & {
  readonly sessionId: string;
};

function parseHashParams(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  const stripped = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const pair of stripped.split('&')) {
    if (!pair) {
      continue;
    }
    const eq = pair.indexOf('=');
    if (eq === -1) {
      out[pair] = '';
    } else {
      out[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return out;
}

function parseQueryParams(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(search);
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

function decodeBase64Json(raw: string): unknown {
  try {
    const bytes = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(bytes);
  } catch {
    return null;
  }
}

function isPageContextKind(s: string): s is PageContextKind {
  return (
    s === 'project' ||
    s === 'task' ||
    s === 'tasks-list' ||
    s === 'agenda' ||
    s === 'agenda-today' ||
    s === 'doc' ||
    s === 'docs-list' ||
    s === 'library' ||
    s === 'struggle' ||
    s === 'hub'
  );
}

function applyCtxDeepLink(spec: string): void {
  const [kindRaw, idRaw] = spec.split(':');
  if (!kindRaw || !isPageContextKind(kindRaw)) {
    return;
  }
  const ctx: PageContext = {
    kind: kindRaw,
    id: idRaw ?? undefined,
    label: idRaw ? `${kindRaw} ${idRaw}` : kindRaw,
  };
  pinnedContext.value = ctx;
}

function materialiseMessage(m: InjectedMessage): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender,
    senderUserId: m.senderUserId ?? 'demo',
    senderDeviceId: m.senderDeviceId ?? 'demo-device',
    text: m.text ?? '',
    pending: m.pending ?? false,
    parentId: m.parentId,
    createdAt: m.createdAt ?? new Date().toISOString(),
    ...(m.model ? { model: m.model } : {}),
    ...(m.inputTokens === undefined ? {} : { inputTokens: m.inputTokens }),
    ...(m.outputTokens === undefined ? {} : { outputTokens: m.outputTokens }),
    ...(m.costUsd === undefined ? {} : { costUsd: m.costUsd }),
    ...(m.durationMs === undefined ? {} : { durationMs: m.durationMs }),
    ...(m.error ? { error: m.error } : {}),
    ...(m.toolsUsed ? { toolsUsed: m.toolsUsed } : {}),
  };
}

function materialiseConversation(c: InjectedConversation): Conversation {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt ?? new Date().toISOString(),
    updatedAt: c.updatedAt ?? new Date().toISOString(),
    createdByUserId: c.createdByUserId ?? 'demo',
    contextRefs: c.contextRefs ?? [],
    ...(c.pinnedModel ? { pinnedModel: c.pinnedModel } : {}),
    ...(c.scopeOverrideKey ? { scopeOverrideKey: c.scopeOverrideKey } : {}),
  };
}

function materialiseSession(s: InjectedSession): SessionAnnouncement {
  return {
    sessionId: toSessionId(s.sessionId),
    deviceId: s.deviceId ?? 'demo',
    cwd: toAbsolutePath(s.cwd ?? '/tmp/demo'),
    transcriptPath: toAbsolutePath(s.transcriptPath ?? '/tmp/demo/transcript.jsonl'),
    state: s.state ?? 'started',
    updatedAt: s.updatedAt ?? new Date().toISOString(),
    ...(s.lastToolName ? { lastToolName: s.lastToolName } : {}),
    ...(s.lastPromptPreview ? { lastPromptPreview: s.lastPromptPreview } : {}),
    stale: true,
  };
}

function isInjectPayload(v: unknown): v is InjectPayload {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return false;
  }
  const rec: Record<string, unknown> = { ...v };
  if (rec.messages !== undefined && !Array.isArray(rec.messages)) {
    return false;
  }
  if (rec.conversations !== undefined && !Array.isArray(rec.conversations)) {
    return false;
  }
  if (rec.sessions !== undefined && !Array.isArray(rec.sessions)) {
    return false;
  }
  return true;
}

function applyInjection(payload: InjectPayload): void {
  const nextConvos = (payload.conversations ?? []).map(materialiseConversation);
  const nextMessages = (payload.messages ?? []).map(materialiseMessage);
  const nextSessions = (payload.sessions ?? []).map(materialiseSession);
  if (nextConvos.length === 0 && nextMessages.length === 0 && nextSessions.length === 0) {
    return;
  }
  injectedOverlay.value = {
    conversations: [...injectedOverlay.value.conversations, ...nextConvos],
    messages: [...injectedOverlay.value.messages, ...nextMessages],
    sessions: [...injectedOverlay.value.sessions, ...nextSessions],
    demoBannerSeen: injectedOverlay.value.demoBannerSeen,
  };
  // Voluntary touches on the mesh-facing signals trigger a render,
  // but we don't write to them here — we only read chatState /
  // sessionsActive and rely on ChatWidget merging overlay entries.
  void chatState.value;
  void sessionsActive.value;
}

/** Apply any URL-driven view tweaks. Call once at app boot; safe to
 * call again on popstate / hashchange. Writes to view-only signals
 * only — never to the mesh. */
export function applyUrlHooks(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const query = parseQueryParams(window.location.search);
  const hash = parseHashParams(window.location.hash);
  if (query.widget === 'open') {
    widgetOpen.value = true;
  }
  if (hash.chat) {
    activeConversationId.value = hash.chat;
    widgetOpen.value = true;
  }
  if (hash.ctx) {
    applyCtxDeepLink(hash.ctx);
  }
  if (hash.__inject) {
    const decoded = decodeBase64Json(hash.__inject);
    if (isInjectPayload(decoded)) {
      applyInjection(decoded);
      widgetOpen.value = true;
    }
  }
}
