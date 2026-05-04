// Action registry for the Chat widget. The widget lives in every
// mesh-gated page so these actions need to work wherever the user
// is when they press Send.

import { type BinaryDocumentId, interpretAsDocumentId } from '@automerge/automerge-repo/slim';
import { ConfirmDialog } from '@fairfox/polly/ui';
import { buildFreshnessActions } from '@fairfox/shared/build-freshness';
import { loadOrCreateKeyring } from '@fairfox/shared/keyring';
import { currentPageContext, type PageContext } from '@fairfox/shared/page-context';
import { pairingActions } from '@fairfox/shared/pairing-actions';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import nacl from 'tweetnacl';
import { historyViewSignals } from '#src/client/App.tsx';
import type { Chat, Message } from '#src/client/state.ts';
import {
  activeChatId,
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

/** Find an existing chat matching a page-context "anchor", so
 * repeatedly opening the widget on the same entity page continues
 * the same thread. Returns undefined when no match. */
function findAnchorChat(ctx: PageContext): Chat | undefined {
  const key = `${ctx.kind}:${ctx.id ?? ''}`;
  return chatState.value.chats.find((c) => {
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

/** Ensure there's an active chat: reuse one anchored to the current
 * page context if available, otherwise start a fresh one. Returns
 * the chat that should carry the next message. */
function ensureActiveChat(
  creatorUserId: string,
  seedText: string,
  pageCtx: PageContext | null
): Chat {
  const activeId = activeChatId.value;
  if (activeId) {
    const existing = chatState.value.chats.find((c) => c.id === activeId);
    if (existing) {
      return existing;
    }
  }
  if (pageCtx) {
    const anchor = findAnchorChat(pageCtx);
    if (anchor) {
      activeChatId.value = anchor.id;
      return anchor;
    }
  }
  const now = new Date().toISOString();
  const fresh: Chat = {
    id: generateId(),
    title: shortTitleFrom(seedText) || undefined,
    createdAt: now,
    updatedAt: now,
    createdByUserId: creatorUserId,
    contextRefs: pageCtx ? [pageCtx] : [],
  };
  chatState.value = {
    ...chatState.value,
    chats: [...chatState.value.chats, fresh],
  };
  activeChatId.value = fresh.id;
  return fresh;
}

function appendContextToChat(chatId: string, ctx: PageContext): void {
  chatState.value = {
    ...chatState.value,
    chats: chatState.value.chats.map((c) => {
      if (c.id !== chatId) {
        return c;
      }
      if (contextAlreadyPresent(c.contextRefs, ctx)) {
        return c;
      }
      return { ...c, contextRefs: [...c.contextRefs, ctx] };
    }),
  };
}

function bumpChatTimestamp(chatId: string): void {
  const now = new Date().toISOString();
  chatState.value = {
    ...chatState.value,
    chats: chatState.value.chats.map((c) => (c.id === chatId ? { ...c, updatedAt: now } : c)),
  };
}

export const CHAT_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  'chat.send',
  'chat.delete',
  'chat.cancel-pending',
  'chat.new',
  'chat.open',
  'chat.archive',
  'chat.remove-context',
  'chat.regenerate',
]);

/** Polly's `$meshState` derives a content-addressable DocumentId by
 * SHA-512-hashing the domain-prefixed key and taking the first 16
 * bytes. Mirrored here from polly's mesh-state.ts (it isn't
 * exported) so the repair action can compute the chat:main docId
 * without holding a healthy `chatState.handle` — exactly the
 * situation it's meant to recover from. */
const POLLY_DOC_ID_DOMAIN = 'polly/meshState/v1';
const MESH_REPO_DB_NAME = 'fairfox-mesh';
const MESH_REPO_STORE_NAME = 'documents';
const CHAT_MAIN_KEY = 'chat:main';

function deriveMeshDocumentId(key: string): string {
  const encoded = new TextEncoder().encode(`${POLLY_DOC_ID_DOMAIN}:${key}`);
  const digest = nacl.hash(encoded);
  return interpretAsDocumentId(digest.slice(0, 16) as unknown as BinaryDocumentId);
}

/** Open the polly mesh repo's IndexedDB and delete every entry whose
 * compound key starts with the supplied DocumentId — i.e. snapshots,
 * incremental chunks, and sync-state for that doc. Other documents
 * (mesh:devices, mesh:users, agenda:main, todo:*, …) and the
 * keyring (which lives in a separate IDB, `fairfox-keyring`) are
 * untouched. The repo will reconstruct the doc on the next page
 * load by re-syncing from peers, so a healthy laptop still holds
 * the canonical state and nothing the user typed is lost from the
 * mesh — only this device's local copy. */
async function repairChatMainStorage(): Promise<void> {
  const documentId = deriveMeshDocumentId(CHAT_MAIN_KEY);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(MESH_REPO_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    const tx = db.transaction(MESH_REPO_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MESH_REPO_STORE_NAME);
    const range = IDBKeyRange.bound([documentId], [documentId, '￿']);
    store.delete(range);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

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

  'chat.reload-for-self-endorse': () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  },

  // Chat lifecycle ----------------------------------------------
  'chat.new': () => {
    activeChatId.value = null;
    pinnedContext.value = null;
    resetDraft();
  },

  'chat.open': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    activeChatId.value = id;
    widgetOpen.value = true;
  },

  'chat.archive': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    const now = new Date().toISOString();
    chatState.value = {
      ...chatState.value,
      chats: chatState.value.chats.map((c) => (c.id === id ? { ...c, archivedAt: now } : c)),
    };
    if (activeChatId.value === id) {
      activeChatId.value = null;
    }
  },

  'chat.remove-context': (ctx) => {
    const chatId = ctx.data.chatId;
    const key = ctx.data.key;
    if (!chatId || !key) {
      return;
    }
    chatState.value = {
      ...chatState.value,
      chats: chatState.value.chats.map((c) => {
        if (c.id !== chatId) {
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
    // Gate writes behind `chatState.loaded`. Polly's $crdtState
    // installs the signal-to-handle write-back effect inside its
    // loaded promise, *and* resets `inner.value` from the on-disk
    // doc as part of that initialisation (mesh.js:1687). A write
    // that lands before loaded resolves updates the Preact signal
    // (so the bubble renders), then gets clobbered when polly
    // overwrites `inner.value` — the message is silently lost and
    // never reaches the underlying Automerge doc, so no sync
    // message ever leaves the device. Waiting on `chatState.loaded`
    // is the same guard 94a09a3 added on the relay side.
    void Promise.all([chatState.loaded, derivePeerId()]).then(([, peerId]) => {
      const chat = ensureActiveChat(identity.userId, text, pageCtx);
      if (pageCtx) {
        appendContextToChat(chat.id, pageCtx);
      }
      const message: Message = {
        id: generateId(),
        chatId: chat.id,
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
      bumpChatTimestamp(chat.id);
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

  // Regenerate an errored assistant turn. Deletes the assistant
  // error reply and flips its user parent back to pending, so the
  // relay picks it up on its next tick. Only exposed on assistant
  // messages carrying an `error` extras field.
  'chat.regenerate': (ctx) => {
    const id = ctx.data.id;
    if (!id) {
      return;
    }
    const errored = chatState.value.messages.find((m) => m.id === id);
    if (!errored || errored.sender !== 'assistant' || !errored.parentId) {
      return;
    }
    const parentId = errored.parentId;
    chatState.value = {
      ...chatState.value,
      messages: chatState.value.messages
        .filter((m) => m.id !== id)
        .map((m) => (m.id === parentId ? { ...m, pending: true } : m)),
    };
  },

  'chat.history-search': (ctx) => {
    historyViewSignals.searchQuery.value = ctx.data.value ?? '';
  },

  'chat.history-toggle-archived': () => {
    historyViewSignals.showArchived.value = !historyViewSignals.showArchived.value;
  },

  // Targeted repair for the "wrapper handle never bridged" failure
  // mode — symptom: pending bubbles never replicate, badge can't
  // tell relay-live from relay-gone, and a normal reload doesn't
  // help because the corrupted chat:main doc is on disk and polly
  // re-loads it on every boot. Wipes only chat:main from the mesh
  // IndexedDB; keyring, mesh:devices, mesh:users, and every other
  // sub-app's docs survive. Reload is forced after the delete so
  // the SPA boots clean and re-syncs chat:main from peers.
  'chat.repair-storage': () => {
    if (typeof window === 'undefined') {
      return;
    }
    void (async () => {
      const ok = await ConfirmDialog.confirm({
        title: 'Repair chat on this device?',
        body:
          "Clears this device's local copy of chat:main and reloads. " +
          'Other paired devices keep the full history and will re-share it after reload. ' +
          'The keyring, peer list, and every other app (todo, agenda, library, …) are untouched.',
        danger: true,
        confirmLabel: 'Repair and reload',
      });
      if (!ok) {
        return;
      }
      try {
        await repairChatMainStorage();
      } catch (err) {
        console.error('[chat.repair-storage] failed:', err);
      }
      window.location.reload();
    })();
  },
};
