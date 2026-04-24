/** @jsxImportSource preact */
// Chat history archive — the `/chat` sub-app now lists past
// conversations with their titles, context chips, and last
// activity. The composer and live thread view live in the
// always-mounted ChatWidget; this page is the "find me that
// conversation from last Tuesday" surface.

import { ActionInput, Badge, Button, Layout } from '@fairfox/polly/ui';
import { HubBack } from '@fairfox/shared/hub-back';
import { setPageContext } from '@fairfox/shared/page-context';
import { effect, signal } from '@preact/signals';
import type { Conversation, Message } from '#src/client/state.ts';
import { chatState } from '#src/client/state.ts';

const searchQuery = signal<string>('');
const showArchived = signal<boolean>(false);

function conversationMessages(conversationId: string): Message[] {
  return chatState.value.messages
    .filter((m) => m.conversationId === conversationId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function lastMessageOf(conversationId: string): Message | undefined {
  const msgs = conversationMessages(conversationId);
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

function matchesQuery(convo: Conversation, query: string): boolean {
  if (!query) {
    return true;
  }
  const needle = query.toLowerCase();
  if ((convo.title ?? '').toLowerCase().includes(needle)) {
    return true;
  }
  for (const ctx of convo.contextRefs) {
    if (ctx.label.toLowerCase().includes(needle)) {
      return true;
    }
    if ((ctx.id ?? '').toLowerCase().includes(needle)) {
      return true;
    }
  }
  for (const m of conversationMessages(convo.id)) {
    if (m.text.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function ConversationRow({ convo }: { convo: Conversation }) {
  const last = lastMessageOf(convo.id);
  const msgCount = conversationMessages(convo.id).length;
  return (
    <Layout
      columns="1fr auto auto"
      gap="var(--polly-space-sm)"
      alignItems="center"
      padding="var(--polly-space-sm) var(--polly-space-md)"
    >
      <div>
        <Layout columns="auto 1fr" gap="0.5rem" alignItems="center">
          <strong>{convo.title ?? '(untitled)'}</strong>
          {convo.archivedAt && <Badge variant="default">archived</Badge>}
        </Layout>
        {convo.contextRefs.length > 0 && (
          <div style={{ marginTop: '0.25rem' }}>
            {convo.contextRefs.map((r) => (
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
        {msgCount} msg · {formatDateTime(convo.updatedAt)}
      </span>
      <Layout columns="auto auto" gap="0.25rem">
        <Button
          label="Continue"
          tier="primary"
          size="small"
          data-action="chat.open-conversation"
          data-action-id={convo.id}
        />
        {!convo.archivedAt && (
          <Button
            label="Archive"
            tier="tertiary"
            size="small"
            data-action="chat.archive-conversation"
            data-action-id={convo.id}
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
  const convos = chatState.value.conversations
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
        <Button label="+ New" tier="primary" size="small" data-action="chat.new-conversation" />
      </Layout>
      <Layout rows="auto" gap="var(--polly-space-xs)">
        {convos.length === 0 ? (
          <p style={{ color: 'var(--polly-text-muted)' }}>
            {chatState.value.conversations.length === 0
              ? 'No conversations yet. Open the chat widget (bottom-right) to start one.'
              : 'No conversations match your filter.'}
          </p>
        ) : (
          convos.map((c) => <ConversationRow key={c.id} convo={c} />)
        )}
      </Layout>
    </Layout>
  );
}

export const historyViewSignals = { searchQuery, showArchived };
