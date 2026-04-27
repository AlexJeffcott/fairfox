/** @jsxImportSource preact */
// ChatWidget — the always-mounted floating assistant. Collapsed it
// renders a single bottom-right button; expanded it's a full-screen
// modal on mobile and a docked panel on wider screens. Shows the
// active chat's message tail, a composer with the live page context
// chip, and a small header with new / close controls.

import { ActionInput, Button, Layout } from '@fairfox/polly/ui';
import { devicesState } from '@fairfox/shared/devices-state';
import { currentPageContext, type PageContext } from '@fairfox/shared/page-context';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import { usersState } from '@fairfox/shared/users-state';
import type { Chat, Message } from '#src/client/state.ts';
import {
  activeChatId,
  chatState,
  draftText,
  injectedOverlay,
  pinnedContext,
  sessionsActive,
  widgetOpen,
} from '#src/client/state.ts';

const BUTTON_SIZE = 56;

function displayNameFor(userId: string): string {
  const entry = usersState.value.users[userId];
  if (entry?.displayName) {
    return entry.displayName;
  }
  return userId.slice(0, 8);
}

function deviceNameFor(deviceId: string): string {
  const entry = devicesState.value.devices[deviceId];
  if (entry?.name) {
    return entry.name;
  }
  return deviceId.slice(0, 8);
}

function formatTime(iso: string): string {
  if (!iso) {
    return '';
  }
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}

/** IDs of messages + sessions + chats that came from a URL
 * #__inject= payload. Used to tag overlay entries with a "(demo)"
 * marker and to render a banner so nothing injected can pass for a
 * real message. */
function overlayIds(): { messages: Set<string>; sessions: Set<string>; chats: Set<string> } {
  const ov = injectedOverlay.value;
  return {
    messages: new Set(ov.messages.map((m) => m.id)),
    sessions: new Set(ov.sessions.map((s) => `${s.sessionId}`)),
    chats: new Set(ov.chats.map((c) => c.id)),
  };
}

function hasOverlay(): boolean {
  const ov = injectedOverlay.value;
  return ov.messages.length > 0 || ov.sessions.length > 0 || ov.chats.length > 0;
}

function activeChat(): Chat | undefined {
  const id = activeChatId.value;
  if (!id) {
    return undefined;
  }
  const mesh = chatState.value.chats.find((c) => c.id === id);
  if (mesh) {
    return mesh;
  }
  return injectedOverlay.value.chats.find((c) => c.id === id);
}

function messagesForActive(): Message[] {
  const chat = activeChat();
  if (!chat) {
    return [];
  }
  const mesh = chatState.value.messages.filter((m) => m.chatId === chat.id);
  const overlay = injectedOverlay.value.messages.filter((m) => m.chatId === chat.id);
  return [...mesh, ...overlay].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function anyPending(): boolean {
  return chatState.value.messages.some((m) => m.sender === 'user' && m.pending);
}

function ContextChip({ ctx, onDetachAction }: { ctx: PageContext; onDetachAction?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.15rem 0.55rem',
        background: '#e8edf3',
        color: '#1c1917',
        border: '1px solid #c6cfd9',
        borderRadius: '999px',
        fontSize: '0.78rem',
      }}
    >
      <span style={{ fontFamily: 'var(--polly-font-mono)' }}>{ctx.kind}</span>
      <span>{ctx.label}</span>
      {onDetachAction && (
        <button
          type="button"
          data-action={onDetachAction}
          data-action-kind={ctx.kind}
          data-action-id={ctx.id ?? ''}
          data-action-key={`${ctx.kind}:${ctx.id ?? ''}`}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.9rem',
            lineHeight: 1,
            padding: 0,
            color: '#6b7280',
          }}
          aria-label={`Remove ${ctx.label}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function FloatingButton() {
  const pending = anyPending();
  return (
    <button
      type="button"
      data-action="chat.toggle-widget"
      aria-label="Open chat assistant"
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: '1rem',
        width: `${BUTTON_SIZE}px`,
        height: `${BUTTON_SIZE}px`,
        borderRadius: '50%',
        border: 'none',
        background: '#2563eb',
        color: 'white',
        cursor: 'pointer',
        fontSize: '1.5rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span role="img" aria-hidden="true">
        💬
      </span>
      {pending && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '12px',
            height: '12px',
            background: '#ef4444',
            borderRadius: '50%',
            border: '2px solid #2563eb',
          }}
        />
      )}
    </button>
  );
}

function MessageBubble({
  message,
  selfDeviceId,
}: {
  message: Message;
  selfDeviceId: string | null;
}) {
  const isAssistant = message.sender === 'assistant';
  const isSelf = !isAssistant && message.senderDeviceId === selfDeviceId;
  const isDemo = overlayIds().messages.has(message.id);
  const bg = isDemo ? '#fef3c7' : isAssistant ? '#e8edf3' : isSelf ? '#dbeafe' : '#ffffff';
  const border = isDemo ? '#f59e0b' : isAssistant ? '#c6cfd9' : isSelf ? '#bcd5f5' : '#e7e5e4';
  const label = isAssistant
    ? `Claude${isDemo ? ' · demo' : ''}`
    : `${displayNameFor(message.senderUserId)} · ${deviceNameFor(message.senderDeviceId)}${isDemo ? ' · demo' : ''}`;
  return (
    <Layout rows="auto auto" gap="0.15rem" padding="0.35rem 0">
      <Layout columns="auto 1fr auto" gap="0.5rem" alignItems="center">
        <strong
          style={{
            fontSize: '0.75rem',
            color: isAssistant ? '#047857' : '#1c1917',
          }}
        >
          {label}
        </strong>
        <span />
        <span
          style={{
            fontSize: '0.75rem',
            color: '#6b7280',
          }}
        >
          {formatTime(message.createdAt)}
          {message.pending && !isAssistant && ' · pending'}
        </span>
      </Layout>
      <div
        style={{
          background: bg,
          color: '#1c1917',
          border: `1px solid ${border}`,
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '0.9rem',
        }}
      >
        {message.text}
      </div>
      {isAssistant && (message.model || message.costUsd !== undefined || message.error) ? (
        <div
          style={{
            fontSize: '0.7rem',
            color: message.error ? '#b45309' : '#6b7280',
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {message.model ? <span>{shortModel(message.model)}</span> : null}
          {message.costUsd !== undefined && message.costUsd > 0 ? (
            <span>${message.costUsd.toFixed(4)}</span>
          ) : null}
          {message.durationMs === undefined ? null : (
            <span>{Math.round(message.durationMs / 100) / 10}s</span>
          )}
          {message.error ? <span>error: {message.error.kind}</span> : null}
          {message.error && message.parentId ? (
            <button
              type="button"
              data-action="chat.regenerate"
              data-action-id={message.id}
              aria-label="Regenerate this reply"
              style={{
                background: 'transparent',
                border: '1px solid #b45309',
                color: '#b45309',
                borderRadius: '999px',
                padding: '0.05rem 0.5rem',
                fontSize: '0.7rem',
                cursor: 'pointer',
              }}
            >
              ↻ regenerate
            </button>
          ) : null}
        </div>
      ) : null}
    </Layout>
  );
}

function shortModel(id: string): string {
  // claude-sonnet-4-6 → Sonnet 4.6; fall back to raw id.
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/);
  if (!m) {
    return id;
  }
  const [, fam, major, minor] = m;
  const cap = (fam ?? '').slice(0, 1).toUpperCase() + (fam ?? '').slice(1);
  return `${cap} ${major}.${minor}`;
}

function Composer({ selfPeerId }: { selfPeerId: string | null }) {
  const identity = userIdentity.value;
  if (!identity) {
    return (
      <p style={{ margin: 0, color: '#6b7280', fontSize: '0.85rem', padding: '0.5rem' }}>
        Connect your identity on the hub's Peers tab before sending messages.
      </p>
    );
  }
  if (!selfPeerId) {
    return null;
  }
  const live = pinnedContext.value ?? currentPageContext.value;
  const pinned = pinnedContext.value !== null;
  return (
    <Layout rows="auto auto" gap="0.35rem">
      <Layout columns="1fr auto" gap="0.35rem" alignItems="center">
        <Layout columns="auto auto" gap="0.35rem" alignItems="center">
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            {pinned ? 'Pinned:' : 'Context:'}
          </span>
          {live ? (
            <ContextChip ctx={live} />
          ) : (
            <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>(none)</span>
          )}
        </Layout>
        {live && (
          <Button
            label={pinned ? 'Unpin' : 'Pin'}
            tier="tertiary"
            size="small"
            data-action={pinned ? 'chat.unpin-context' : 'chat.pin-context'}
          />
        )}
      </Layout>
      <Layout columns="1fr auto" gap="0.5rem" alignItems="stretch">
        <ActionInput
          value={draftText.value}
          variant="multi"
          action="chat.draft-text"
          saveOn="blur"
          placeholder="Ask Claude…"
          ariaLabel="Message text"
        />
        <Button label="Send" tier="primary" data-action="chat.send" />
      </Layout>
    </Layout>
  );
}

function ChatHeader({ chat }: { chat: Chat | undefined }) {
  const title = chat?.title ?? 'New chat';
  return (
    <Layout columns="1fr auto auto" gap="0.35rem" alignItems="center">
      <strong style={{ fontSize: '0.95rem' }}>{title}</strong>
      <Button
        label="New"
        tier="tertiary"
        size="small"
        data-action="chat.new"
        title="Start a fresh chat — current one stays in history"
      />
      <Button label="Close" tier="tertiary" size="small" data-action="chat.close-widget" />
    </Layout>
  );
}

function ChatContextStrip({ chat }: { chat: Chat | undefined }) {
  if (!chat || chat.contextRefs.length === 0) {
    return null;
  }
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.35rem',
        padding: '0.25rem 0',
      }}
    >
      <span style={{ fontSize: '0.75rem', color: '#6b7280', alignSelf: 'center' }}>Following:</span>
      {chat.contextRefs.map((ctx) => {
        const key = `${ctx.kind}:${ctx.id ?? ''}`;
        return (
          <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <ContextChip ctx={ctx} />
            <button
              type="button"
              data-action="chat.remove-context"
              data-action-chat-id={chat.id}
              data-action-key={key}
              aria-label={`Remove ${ctx.label} from this chat`}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: '#6b7280',
                fontSize: '0.9rem',
              }}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}

function ActiveCcSessions() {
  const mesh = sessionsActive.value.sessions;
  const overlay = injectedOverlay.value.sessions;
  const sessions = [...mesh, ...overlay];
  if (sessions.length === 0) {
    return null;
  }
  const demoIds = overlayIds().sessions;
  return (
    <div style={{ padding: '0.35rem 0', borderTop: '1px dashed #e7e5e4' }}>
      <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Claude Code:</span>
      {sessions.map((s) => {
        const leaf = `${s.cwd}`.split('/').slice(-2).join('/');
        const state = s.state;
        const isDemo = demoIds.has(`${s.sessionId}`);
        return (
          <div
            key={`${s.sessionId}`}
            style={{
              fontSize: '0.75rem',
              color: s.stale ? '#9ca3af' : '#1c1917',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <span title={`${s.cwd}`}>
              {leaf}
              {isDemo ? ' · demo' : ''}
            </span>
            <span style={{ color: '#6b7280' }}>
              {state}
              {s.lastToolName ? ` · ${s.lastToolName}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DemoBanner() {
  if (!hasOverlay()) {
    return null;
  }
  return (
    <div
      style={{
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        color: '#78350f',
        padding: '0.35rem 0.6rem',
        fontSize: '0.75rem',
        borderRadius: '4px',
        margin: '0.25rem 0',
      }}
    >
      ⚠ This widget contains demo data from <code>#__inject=</code> in the URL. None of it is real
      or synced to your other devices.
    </div>
  );
}

function isMobile(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.innerWidth < 640;
}

function Panel({ selfPeerId }: { selfPeerId: string | null }) {
  const chat = activeChat();
  const messages = messagesForActive();
  const mobile = isMobile();
  const panelStyle: preact.JSX.CSSProperties = mobile
    ? {
        position: 'fixed',
        inset: 0,
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
      }
    : {
        position: 'fixed',
        right: '1rem',
        bottom: `${BUTTON_SIZE + 20}px`,
        width: '380px',
        maxHeight: '70vh',
        background: '#ffffff',
        border: '1px solid #e7e5e4',
        borderRadius: '12px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
        overflow: 'hidden',
      };
  return (
    <div style={panelStyle}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e7e5e4' }}>
        <ChatHeader chat={chat} />
        <DemoBanner />
        <ChatContextStrip chat={chat} />
        <ActiveCcSessions />
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.5rem 1rem',
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '0.5rem 0' }}>
            New thread. Type below — the laptop's <code>fairfox chat serve</code> will reply.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} selfDeviceId={selfPeerId} />)
        )}
      </div>
      <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #e7e5e4' }}>
        <Composer selfPeerId={selfPeerId} />
      </div>
    </div>
  );
}

function useSelfPeerId(): string | null {
  const identity = userIdentity.value;
  if (!identity) {
    return null;
  }
  for (const [peerId, entry] of Object.entries(devicesState.value.devices)) {
    if ((entry.ownerUserIds ?? []).includes(identity.userId)) {
      return peerId;
    }
  }
  return null;
}

export function ChatWidget(): preact.JSX.Element {
  const selfPeerId = useSelfPeerId();
  // Render both so Preact can keep the panel mounted while it
  // animates in/out if we ever add a transition. Visibility is
  // controlled by widgetOpen.value.
  return (
    <>
      <FloatingButton />
      {widgetOpen.value && <Panel selfPeerId={selfPeerId} />}
    </>
  );
}
