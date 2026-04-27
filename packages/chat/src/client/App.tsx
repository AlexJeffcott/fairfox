/** @jsxImportSource preact */
// Chat history archive — the `/chat` sub-app lists past chats with
// their titles, context chips, and last activity. The composer and
// live thread view live in the always-mounted ChatWidget; this page
// is the "find me that chat from last Tuesday" surface.

import { ActionInput, Badge, Button, Layout } from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { effect, signal } from '@preact/signals';
import type { Chat, Message } from '#src/client/state.ts';
import { chatState } from '#src/client/state.ts';

const searchQuery = signal<string>('');
const showArchived = signal<boolean>(false);

function chatMessages(chatId: string): Message[] {
  return chatState.value.messages
    .filter((m) => m.chatId === chatId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function lastMessageOf(chatId: string): Message | undefined {
  const msgs = chatMessages(chatId);
  return msgs[msgs.length - 1];
}

function formatDateTime(iso: string): string {
  if (!iso) {
    return '';
  }
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) {
      return `${hh}:${mm}`;
    }
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${mo}-${day} ${hh}:${mm}`;
  } catch {
    return iso.slice(0, 16);
  }
}

function matchesQuery(chat: Chat, query: string): boolean {
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  if ((chat.title ?? '').toLowerCase().includes(needle)) {
    return true;
  }
  for (const ctx of chat.contextRefs) {
    if (ctx.label.toLowerCase().includes(needle)) {
      return true;
    }
    if ((ctx.id ?? '').toLowerCase().includes(needle)) {
      return true;
    }
  }
  for (const m of chatMessages(chat.id)) {
    if (m.text.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function ChatRow({ chat }: { chat: Chat }) {
  const last = lastMessageOf(chat.id);
  const msgCount = chatMessages(chat.id).length;
  return (
    <Layout
      columns="1fr auto auto"
      gap="var(--polly-space-sm)"
      alignItems="center"
      padding="var(--polly-space-sm) var(--polly-space-md)"
    >
      <div>
        <Layout columns="auto 1fr" gap="0.5rem" alignItems="center">
          <strong>{chat.title ?? '(untitled)'}</strong>
          {chat.archivedAt && <Badge variant="default">archived</Badge>}
        </Layout>
        {chat.contextRefs.length > 0 && (
          <div style={{ marginTop: '0.25rem' }}>
            {chat.contextRefs.map((r) => (
              <span
                key={`${r.kind}:${r.id ?? ''}`}
                style={{
                  display: 'inline-block',
                  padding: '0.1rem 0.5rem',
                  marginRight: '0.35rem',
                  background: '#e8edf3',
                  border: '1px solid #c6cfd9',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                }}
              >
                {r.kind}: {r.label}
              </span>
            ))}
          </div>
        )}
        {last && (
          <div
            style={{
              marginTop: '0.25rem',
              color: 'var(--polly-text-muted)',
              fontSize: 'var(--polly-text-sm)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {last.sender === 'assistant' ? 'Claude: ' : 'You: '}
            {last.text}
          </div>
        )}
      </div>
      <span style={{ fontSize: 'var(--polly-text-sm)', color: 'var(--polly-text-muted)' }}>
        {msgCount} msg · {formatDateTime(chat.updatedAt)}
      </span>
      <Layout columns="auto auto" gap="0.25rem">
        <Button
          label="Continue"
          tier="primary"
          size="small"
          data-action="chat.open"
          data-action-id={chat.id}
        />
        {!chat.archivedAt && (
          <Button
            label="Archive"
            tier="tertiary"
            size="small"
            data-action="chat.archive"
            data-action-id={chat.id}
          />
        )}
      </Layout>
    </Layout>
  );
}

let chatHistoryEffectsInstalled = false;

/** Publish the page-context marker for the chat history view. */
export function installChatHistoryEffects(): void {
  if (chatHistoryEffectsInstalled) {
    return;
  }
  chatHistoryEffectsInstalled = true;
  effect(() => {
    setPageContext({ kind: 'hub', label: 'Chat history' });
  });
}

export function App() {
  const query = searchQuery.value;
  const archived = showArchived.value;
  const chats = chatState.value.chats
    .filter((c) => (archived ? true : !c.archivedAt))
    .filter((c) => matchesQuery(c, query))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Layout rows="auto auto 1fr" gap="var(--polly-space-md)" padding="var(--polly-space-lg)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <h1 style={{ margin: 0 }}>Chat history</h1>
        <HubBack />
      </Layout>
      <Layout columns="1fr auto auto" gap="var(--polly-space-sm)" alignItems="center">
        <ActionInput
          value={query}
          variant="single"
          action="chat.history-search"
          saveOn="blur"
          placeholder="Search titles, context, message bodies…"
          ariaLabel="Search"
        />
        <Button
          label={archived ? 'Hide archived' : 'Show archived'}
          tier="tertiary"
          size="small"
          data-action="chat.history-toggle-archived"
        />
        <Button label="+ New" tier="primary" size="small" data-action="chat.new" />
      </Layout>
      <Layout rows="auto" gap="var(--polly-space-xs)">
        {chats.length === 0 ? (
          <p style={{ color: 'var(--polly-text-muted)' }}>
            {chatState.value.chats.length === 0
              ? 'No chats yet. Open the chat widget (bottom-right) to start one.'
              : 'No chats match your filter.'}
          </p>
        ) : (
          chats.map((c) => <ChatRow key={c.id} chat={c} />)
        )}
      </Layout>
    </Layout>
  );
}

export const historyViewSignals = { searchQuery, showArchived };
