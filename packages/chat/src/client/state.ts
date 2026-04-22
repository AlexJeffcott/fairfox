// Chat state — one household conversation held in a single $meshState
// document. Every paired device sees the same message list; attribution
// on each row (userId + deviceId) keeps interleaved posts legible.
// Context is per-message, not per-thread, so different asks can target
// different sub-apps without needing separate threads.

import '@fairfox/shared/ensure-mesh';
import { $meshState } from '@fairfox/polly/mesh';
import { signal } from '@preact/signals';

export type Sender = 'user' | 'assistant';

/** Sub-app doc a message is asking about. The relay uses this to pick
 * which mesh doc to serialize into the prompt. */
export type ContextKind = 'project' | 'task' | 'agenda' | 'doc';

export interface ContextRef {
  [key: string]: unknown;
  kind: ContextKind;
  id: string;
}

export interface Message {
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

export interface ChatDoc {
  [key: string]: unknown;
  messages: Message[];
}

export const chatState = $meshState<ChatDoc>('chat:main', { messages: [] });

/** Draft state for the composer. Lives on a local signal so partial
 * text doesn't replicate to every peer before Send. */
export interface MessageDraft {
  text: string;
  contextKind: ContextKind | '';
  contextId: string;
}

export const messageDraft = signal<MessageDraft>({
  text: '',
  contextKind: '',
  contextId: '',
});

export function resetDraft(): void {
  messageDraft.value = { text: '', contextKind: '', contextId: '' };
}
