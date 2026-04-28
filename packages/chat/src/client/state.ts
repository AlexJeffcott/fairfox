// Chat state — household assistant threads held in a single $meshState
// document. Two entities: chats and messages. Each message belongs to
// a chat; each chat owns the list of contextRefs it has accumulated
// (page context automatically appends here on send, so the relay
// keeps seeing the relevant records even after the user navigates
// away).

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import type {
  AssistantMessageExtras,
  ChatExtras,
  ChatHealth,
  SessionsActive,
} from '@fairfox/shared/assistant-state';
import {
  CHAT_HEALTH_DOC_ID,
  CHAT_HEALTH_INITIAL,
  SESSIONS_ACTIVE_DOC_ID,
} from '@fairfox/shared/assistant-state';
import type { PageContext } from '@fairfox/shared/page-context';
import { signal } from '@preact/signals';

export type Sender = 'user' | 'assistant';

export interface Chat extends ChatExtras {
  [key: string]: unknown;
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  /** Context records the chat has accumulated — page contexts
   * attached from send sites, any manual additions. The relay reads
   * this to build its prompt, so adding to the list on every send
   * keeps the chat "sticky" to its topic even when the user
   * navigates. */
  contextRefs: PageContext[];
  archivedAt?: string;
}

export interface Message extends AssistantMessageExtras {
  [key: string]: unknown;
  id: string;
  chatId: string;
  sender: Sender;
  senderUserId: string;
  senderDeviceId: string;
  text: string;
  pending: boolean;
  parentId?: string;
  /** Per-message context override — rarely set; the chat's
   * contextRefs usually supply everything the relay needs. */
  contextRef?: PageContext;
  createdAt: string;
}

export interface ChatDoc {
  [key: string]: unknown;
  chats: Chat[];
  messages: Message[];
}

export const chatState = $meshState<ChatDoc>('chat:main', {
  chats: [],
  messages: [],
});

// Pre-rename meshes carry `{ conversations, messages }` with
// `Message.conversationId`. Use handle.change to delete legacy
// keys at the Automerge level — assigning to chatState.value
// only writes the keys we set, so a top-level overwrite leaves
// `conversations` in place and the migration condition stays
// true forever, wiping fresh pendings on every load. Only
// strip legacy-shape messages; new ones survive.
void chatState.loaded.then(() => {
  const v = chatState.value as unknown as Record<string, unknown>;
  const handle = chatState.handle;
  if (!handle) {
    return;
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
  if (!hasLegacyKey && !hasLegacyMessages) {
    return;
  }
  handle.change((doc: Record<string, unknown>) => {
    if (doc.conversations !== undefined) {
      delete doc.conversations;
    }
    if (Array.isArray(doc.messages) && hasLegacyMessages) {
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
});

/** Mesh doc of live Claude Code sessions — populated by the daemon's
 * `fairfox daemon hook` command when CC fires SessionStart etc. The
 * widget renders a strip of active sessions when this list is
 * non-empty, so a phone user can see at a glance what the laptop is
 * doing. */
export const sessionsActive = $meshState<SessionsActive>(SESSIONS_ACTIVE_DOC_ID, {
  sessions: [],
});

/** Self-reported relay state. Every running `fairfox chat serve`
 * upserts its own row keyed by peerId on each heartbeat tick.
 * Empty `relays` means no relay has ever announced itself on this
 * mesh; a row with an old `lastTickAt` means a relay started but
 * stopped (crashed or ctrl-c'd). The widget renders a header
 * badge derived from this so the user can tell at a glance
 * whether the laptop is ready to reply. */
export const chatHealth = $meshState<ChatHealth>(CHAT_HEALTH_DOC_ID, CHAT_HEALTH_INITIAL);

/** View-only overlay for demo / test injections. URL hooks
 * (#__inject=...) write here instead of the mesh doc, so injected
 * items never sync to paired peers and never persist across a
 * reload. The widget merges overlay entries into its render with a
 * visible "(demo)" badge so they're impossible to confuse with real
 * traffic. */
export interface InjectedOverlay {
  readonly chats: readonly Chat[];
  readonly messages: readonly Message[];
  readonly sessions: readonly import('@fairfox/shared/assistant-state').SessionAnnouncement[];
  readonly demoBannerSeen: boolean;
}

export const injectedOverlay = signal<InjectedOverlay>({
  chats: [],
  messages: [],
  sessions: [],
  demoBannerSeen: false,
});

/** Which chat the widget is currently rendering, per device. View
 * state, not mesh state — each device keeps its own active pointer
 * so opening the widget on one device doesn't yank another device's
 * view. `null` means "start a new one on next send". */
export const activeChatId = signal<string | null>(null);

/** Whether the widget panel is expanded (modal/sheet open) or
 * collapsed (button only). */
export const widgetOpen = signal<boolean>(false);

/** Draft text for the composer. Lives on a local signal so partial
 * text doesn't replicate to every peer before Send. */
export const draftText = signal<string>('');

/** Pinned context override for the active chat. When set, every
 * send uses this instead of the current page context. Cleared on
 * "Start fresh" or explicit detach. */
export const pinnedContext = signal<PageContext | null>(null);

export function resetDraft(): void {
  draftText.value = '';
}
