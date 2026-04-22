// Action registry for the Chat widget. The widget lives in every
// mesh-gated page so these actions need to work wherever the user
// is when they press Send.

import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { currentPageContext, type PageContext } from '@fairfox/shared/page-context';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import { historyViewSignals } from '#src/client/App.tsx';
import type { Conversation, Message } from '#src/client/state.ts';
import {
  activeConversationId,
  chatState,
  draftText,
  pinnedContext,
  resetDraft,
  widgetOpen,
} from '#src/client/state.ts';

interface HandlerContext {
  data: Record<string, string>;
  event: Event;
  element: HTMLElement;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function derivePeerId(): Promise<string> {
  const keyring = await loadOrCreateKeyring();
  return Array.from(keyring.identity.publicKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Find an existing conversation matching a page-context "anchor",
 * so repeatedly opening the widget on the same entity page
 * continues the same thread. Returns undefined when no match. */
function findAnchorConversation(ctx: PageContext): Conversation | undefined {
  const key = `${ctx.kind}:${ctx.id ?? ''}`;
  return chatState.value.conversations.find((c) => {
    if (c.archivedAt) {
      return false;
    }
    return c.contextRefs.some((r) => `${r.kind}:${r.id ?? ''}` === key);
  });
}

function effectiveContext(): PageContext | null {
  return pinnedContext.value ?? currentPageContext.value;
}

function contextAlreadyPresent(list: PageContext[], ctx: PageContext): boolean {
  const key = `${ctx.kind}:${ctx.id ?? ''}`;
  return list.some((r) => `${r.kind}:${r.id ?? ''}` === key);
}

function shortTitleFrom(text: string): string {
  const stripped = text.trim().replace(/\s+/g, ' ');
  return stripped.length <= 60 ? stripped : `${stripped.slice(0, 57)}…`;
}

/** Ensure there's an active conversation: reuse one anchored to the
 * current page context if available, otherwise start a fresh one.
 * Returns the conversation that should carry the next message. */
function ensureActiveConversation(
  creatorUserId: string,
  seedText: string,
  pageCtx: PageContext | null
): Conversation {
  const activeId = activeConversationId.value;
  if (activeId) {
    const existing = chatState.value.conversations.find((c) => c.id === activeId);
    if (existing) {
      return existing;
    }
  }
  if (pageCtx) {
    const anchor = findAnchorConversation(pageCtx);
    if (anchor) {
      activeConversationId.value = anchor.id;
      return anchor;
    }
  }
  const now = new Date().toISOString();
  const fresh: Conversation = {
    id: generateId(),
    title: shortTitleFrom(seedText) || undefined,
    createdAt: now,
    updatedAt: now,
    createdByUserId: creatorUserId,
    contextRefs: pageCtx ? [pageCtx] : [],
  };
  chatState.value = {
    ...chatState.value,
    conversations: [...chatState.value.conversations, fresh],
  };
  activeConversationId.value = fresh.id;
  return fresh;
}

function appendContextToConversation(conversationId: string, ctx: PageContext): void {
  chatState.value = {
    ...chatState.value,
    conversations: chatState.value.conversations.map((c) => {
      if (c.id !== conversationId) {
        return c;
      }
      if (contextAlreadyPresent(c.contextRefs, ctx)) {
        return c;
      }
      return { ...c, contextRefs: [...c.contextRefs, ctx] };
    }),
  };
}

function bumpConversationTimestamp(conversationId: string): void {
  const now = new Date().toISOString();
  chatState.value = {
    ...chatState.value,
    conversations: chatState.value.conversations.map((c) =>
      c.id === conversationId ? { ...c, updatedAt: now } : c
    ),
  };
}

export const CHAT_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'chat.send',
  'chat.delete',
  'chat.cancel-pending',
  'chat.new-conversation',
  'chat.open-conversation',
  'chat.archive-conversation',
  'chat.remove-context',
]);

export const registry: Record<string, (ctx: HandlerContext) => void> = {
  ...pairingActions,
  ...buildFreshnessActions,

  // Widget open / close / draft bookkeeping ---------------------
  'chat.toggle-widget': () => {
    widgetOpen.value = !widgetOpen.value;
  },

  'chat.close-widget': () => {
    widgetOpen.value = false;
  },

  'chat.draft-text': (ctx) => {
    draftText.value = ctx.data.value ?? '';
  },

  // Conversation lifecycle --------------------------------------
  'chat.new-conversation': () => {
    activeConversationId.value = null;
    pinnedContext.value = null;
    resetDraft();
  },

  'chat.open-conversation': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    activeConversationId.value = id;
    widgetOpen.value = true;
  },

  'chat.archive-conversation': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    const now = new Date().toISOString();
    chatState.value = {
      ...chatState.value,
      conversations: chatState.value.conversations.map((c) =>
        c.id === id ? { ...c, archivedAt: now } : c
      ),
    };
    if (activeConversationId.value === id) {
      activeConversationId.value = null;
    }
  },

  'chat.remove-context': (ctx) => {
    const conversationId = ctx.data.conversationId;
    const key = ctx.data.key;
    if (!conversationId || !key) {
      return;
    }
    chatState.value = {
      ...chatState.value,
      conversations: chatState.value.conversations.map((c) => {
        if (c.id !== conversationId) {
          return c;
        }
        return {
          ...c,
          contextRefs: c.contextRefs.filter((r) => `${r.kind}:${r.id ?? ''}` !== key),
        };
      }),
    };
  },

  'chat.pin-context': () => {
    pinnedContext.value = currentPageContext.value;
  },

  'chat.unpin-context': () => {
    pinnedContext.value = null;
  },

  // Sending -----------------------------------------------------
  'chat.send': () => {
    const text = draftText.value.trim();
    if (!text) {
      return;
    }
    const identity = userIdentity.value;
    if (!identity) {
      return;
    }
    const pageCtx = effectiveContext();
    void derivePeerId().then((peerId) => {
      const convo = ensureActiveConversation(identity.userId, text, pageCtx);
      if (pageCtx) {
        appendContextToConversation(convo.id, pageCtx);
      }
      const message: Message = {
        id: generateId(),
        conversationId: convo.id,
        sender: 'user',
        senderUserId: identity.userId,
        senderDeviceId: peerId,
        text,
        pending: true,
        createdAt: new Date().toISOString(),
      };
      chatState.value = {
        ...chatState.value,
        messages: [...chatState.value.messages, message],
      };
      bumpConversationTimestamp(convo.id);
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
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    chatState.value = {
      ...chatState.value,
      messages: chatState.value.messages.map((m) => (m.id === id ? { ...m, pending: false } : m)),
    };
  },

  'chat.history-search': (ctx) => {
    historyViewSignals.searchQuery.value = ctx.data.value ?? '';
  },

  'chat.history-toggle-archived': () => {
    historyViewSignals.showArchived.value = !historyViewSignals.showArchived.value;
  },
};
