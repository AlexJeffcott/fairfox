// Action registry for the Chat sub-app. Send composes a new user
// message with pending=true; the laptop-side `fairfox chat serve`
// watches for those and writes back an assistant reply. The browser
// never calls an LLM directly.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import type { ContextKind, Message } from '#src/client/state.ts';
import { chatState, messageDraft, resetDraft } from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const CONTEXT_KINDS = new Set<string>(['project', 'task', 'agenda', 'doc']);
function isContextKind(s: string): s is ContextKind {
  return CONTEXT_KINDS.has(s);
}

async function derivePeerId(): Promise<string> {
  const keyring = await loadOrCreateKeyring();
  return Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Actions that mutate `chat:main`. Gated under `chat.write` once
 * policy.ts grows that permission; ungated today, matching the
 * rollout used by tasks/agenda during Phase E. */
export const CHAT_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'chat.send',
  'chat.delete',
  'chat.cancel-pending',
]);

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

  'chat.draft-text': (ctx) => {
    messageDraft.value = { ...messageDraft.value, text: ctx.data.value ?? '' };
  },

  'chat.draft-kind': (ctx) => {
    const k = ctx.data.value ?? '';
    if (k === '' || isContextKind(k)) {
      messageDraft.value = { ...messageDraft.value, contextKind: k };
    }
  },

  'chat.draft-id': (ctx) => {
    messageDraft.value = { ...messageDraft.value, contextId: (ctx.data.value ?? '').trim() };
  },

  'chat.send': () => {
    const draft = messageDraft.value;
    const text = draft.text.trim();
    if (!text) {
      return;
    }
    const identity = userIdentity.value;
    if (!identity) {
      // No identity — can't attribute the message. UI should already
      // hide the send button in this state; this is belt-and-braces.
      return;
    }
    void derivePeerId().then((peerId) => {
      const message: Message = {
        id: generateId(),
        sender: 'user',
        senderUserId: identity.userId,
        senderDeviceId: peerId,
        text,
        pending: true,
        createdAt: new Date().toISOString(),
      };
      if (draft.contextKind && draft.contextId) {
        message.contextRef = { kind: draft.contextKind, id: draft.contextId };
      }
      chatState.value = {
        ...chatState.value,
        messages: [...chatState.value.messages, message],
      };
      resetDraft();
    });
  },

  'chat.delete': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    chatState.value = {
      ...chatState.value,
      messages: chatState.value.messages.filter((m) => m.id !== id),
    };
  },

  'chat.cancel-pending': (ctx) => {
    // Flag a pending user message as no-longer-needs-a-reply. The
    // relay's idempotency check already skips messages that already
    // have an assistant reply; this is for the other case, where
    // the user wants to rescind before the relay processes.
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    chatState.value = {
      ...chatState.value,
      messages: chatState.value.messages.map((m) => (m.id === id ? { ...m, pending: false } : m)),
    };
  },
};
