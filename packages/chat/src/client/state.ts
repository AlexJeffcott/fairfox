// Chat state — household assistant threads held in a single $meshState
// document. Two entities: conversations and messages. Each message
// belongs to a conversation; each conversation owns the list of
// contextRefs it has accumulated (page context automatically appends
// here on send, so the relay keeps seeing the relevant records even
// after the user navigates away).

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import type {
  AssistantMessageExtras,
  ConversationExtras,
  SessionsActive,
} from '@fairfox/shared/assistant-state';
import { SESSIONS_ACTIVE_DOC_ID } from '@fairfox/shared/assistant-state';
import type { PageContext } from '@fairfox/shared/page-context';
import { signal } from '@preact/signals';

export type Sender = 'user' | 'assistant';

export interface Conversation extends ConversationExtras {
  [key: string]: unknown;
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  /** Context records the conversation has accumulated — page
   * contexts attached from send sites, any manual additions. The
   * relay reads this to build its prompt, so adding to the list on
   * every send keeps the conversation "sticky" to its topic even
   * when the user navigates. */
  contextRefs: PageContext[];
  archivedAt?: string;
}

export interface Message extends AssistantMessageExtras {
  [key: string]: unknown;
  id: string;
  conversationId: string;
  sender: Sender;
  senderUserId: string;
  senderDeviceId: string;
  text: string;
  pending: boolean;
  parentId?: string;
  /** Per-message context override — rarely set; the conversation's
   * contextRefs usually supply everything the relay needs. */
  contextRef?: PageContext;
  createdAt: string;
}

export interface ChatDoc {
  [key: string]: unknown;
  conversations: Conversation[];
  messages: Message[];
}

export const chatState = $meshState<ChatDoc>('chat:main', {
  conversations: [],
  messages: [],
});

/** Mesh doc of live Claude Code sessions — populated by the daemon's
 * `fairfox daemon hook` command when CC fires SessionStart etc. The
 * widget renders a strip of active sessions when this list is
 * non-empty, so a phone user can see at a glance what the laptop is
 * doing. */
export const sessionsActive = $meshState<SessionsActive>(SESSIONS_ACTIVE_DOC_ID, {
  sessions: [],
});

/** Which conversation the widget is currently rendering, per
 * device. View state, not mesh state — each device keeps its own
 * active pointer so opening the widget on one device doesn't yank
 * another device's view. `null` means "start a new one on next
 * send". */
export const activeConversationId = signal<string | null>(null);

/** Whether the widget panel is expanded (modal/sheet open) or
 * collapsed (button only). */
export const widgetOpen = signal<boolean>(false);

/** Draft text for the composer. Lives on a local signal so partial
 * text doesn't replicate to every peer before Send. */
export const draftText = signal<string>('');

/** Pinned context override for the active conversation. When set,
 * every send uses this instead of the current page context. Cleared
 * on "Start fresh" or explicit detach. */
export const pinnedContext = signal<PageContext | null>(null);

export function resetDraft(): void {
  draftText.value = '';
}
