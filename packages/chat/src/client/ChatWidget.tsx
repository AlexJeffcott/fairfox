/** @jsxImportSource preact */
// ChatWidget — the always-mounted floating assistant. Collapsed it
// renders a single bottom-right button; expanded it's a full-screen
// modal on mobile and a docked panel on wider screens. Shows the
// active chat's message tail, a composer with the live page context
// chip, and a small header with new / close controls.

import { ActionInput, Button, Layout, Surface } from '@fairfox/polly/ui';
import type { RelayHealth } from '@fairfox/shared/assistant-state';
import { devicesState } from '@fairfox/shared/devices-state';
import {
  lastSignalingErrorMessage,
  signalingConnected,
} from '@fairfox/shared/mesh-connection-state';
import { currentPageContext, type PageContext } from '@fairfox/shared/page-context';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import { usersState } from '@fairfox/shared/users-state';
import type { Chat, Message } from '#src/client/state.ts';
import {
  activeChatId,
  chatHealth,
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
    <Surface
      as="span"
      variant="chip"
      background="var(--polly-status-info-bg)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        color: 'var(--polly-status-info-text)',
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
            color: 'var(--polly-text-muted)',
          }}
          aria-label={`Remove ${ctx.label}`}
        >
          ×
        </button>
      )}
    </Surface>
  );
}

function FloatingButton() {
  const pending = anyPending();
  return (
    <Surface
      as="button"
      variant="floating"
      radius="full"
      border="none"
      background="var(--polly-accent)"
      width={`${BUTTON_SIZE}px`}
      height={`${BUTTON_SIZE}px`}
      inset="auto 1rem 1rem auto"
      zIndex={9998}
      data-action="chat.toggle-widget"
      aria-label="Open chat assistant"
      style={{
        color: 'var(--polly-accent-contrast)',
        cursor: 'pointer',
        fontSize: '1.5rem',
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
            background: 'var(--polly-danger)',
            borderRadius: '50%',
            border: '2px solid var(--polly-accent)',
          }}
        />
      )}
    </Surface>
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
      <Surface
        variant="bubble"
        background={bg}
        style={{
          // Bubble backgrounds are hardcoded light (#ffffff,
          // #e8edf3, #dbeafe, #fef3c7); the text color must be
          // hardcoded dark too. Reading var(--polly-text) made
          // white-on-white when the user agent's polly theme
          // resolved that variable to a near-white value.
          color: '#1c1917',
          '--polly-border': border,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '0.9rem',
        }}
      >
        {message.text}
      </Surface>
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
                border: '1px solid var(--polly-warning)',
                color: 'var(--polly-warning)',
                borderRadius: 'var(--polly-radius-full)',
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
    // The user is paired (identity is present) but mesh:devices has
    // no row binding our peerId to our userId. This is the
    // post-pair IndexedDB-flush race: the device-endorsement write
    // didn't land before the reload, and in-memory hydration came
    // back without it. Returning null here would silently swallow
    // the failure — the panel would mount with no input and the
    // user would think they sent something they never wrote.
    // Surface the state and offer the repair the boot effect would
    // apply automatically (re-run selfEndorseDevice via reload, or
    // a more targeted heal on the next devicesState tick).
    return (
      <Layout rows="auto auto" gap="0.35rem" padding="0.5rem">
        <p
          style={{
            margin: 0,
            color: 'var(--polly-status-warning-text)',
            fontSize: '0.85rem',
          }}
        >
          Setting up this device — your endorsement hasn't replicated yet. Reload to repair.
        </p>
        <Button
          label="Reload"
          tier="secondary"
          size="small"
          data-action="chat.reload-for-self-endorse"
        />
      </Layout>
    );
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

/** A relay is "live" if it ticked within 90 s, "stale" if within
 * 5 min, otherwise "gone". The threshold is the relay's heartbeat
 * interval (10 s) plus generous slack for clock drift between
 * peers. We compute age as `Date.now() - lastTickAt` where one is
 * the local phone clock and the other is the laptop's; iOS phones
 * routinely drift 30-60 s after a wake. A short threshold there
 * read "stale" while the laptop was actively ticking every 10 s,
 * which is the failure case the user reported. */
const RELAY_LIVE_MS = 90_000;
const RELAY_STALE_MS = 5 * 60 * 1000;

/** "disconnected" wins over chat:health-derived states. If our own
 * signalling WebSocket is down, the relay-staleness rendering is
 * misleading — chat:health rows are stale because we are not
 * receiving anything, not because the relay stopped writing. */
type RelayBadgeKind = 'disconnected' | 'live' | 'stale' | 'gone' | 'none';

interface RelayBadgeState {
  readonly kind: RelayBadgeKind;
  readonly relay?: RelayHealth;
  readonly ageMs?: number;
}

function relayBadgeState(): RelayBadgeState {
  if (!signalingConnected.value) {
    // Reading chatHealth on top of a dead signalling channel
    // would render a misleading "stale" — the relay may be fine,
    // we just aren't hearing it. Surface the actual problem.
    return { kind: 'disconnected' };
  }
  const relays = Object.values(chatHealth.value.relays);
  if (relays.length === 0) {
    return { kind: 'none' };
  }
  const now = Date.now();
  let best: RelayHealth | undefined;
  let bestAge = Number.POSITIVE_INFINITY;
  for (const r of relays) {
    const age = now - new Date(r.lastTickAt).getTime();
    if (age < bestAge) {
      bestAge = age;
      best = r;
    }
  }
  if (!best) {
    return { kind: 'none' };
  }
  if (bestAge <= RELAY_LIVE_MS) {
    return { kind: 'live', relay: best, ageMs: bestAge };
  }
  if (bestAge <= RELAY_STALE_MS) {
    return { kind: 'stale', relay: best, ageMs: bestAge };
  }
  return { kind: 'gone', relay: best, ageMs: bestAge };
}

function formatAge(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  }
  if (ms < 60 * 60_000) {
    return `${Math.round(ms / 60_000)}m ago`;
  }
  return `${Math.round(ms / (60 * 60_000))}h ago`;
}

function RelayBadge() {
  const state = relayBadgeState();
  if (state.kind === 'disconnected') {
    const errorMsg = lastSignalingErrorMessage.value;
    const tip = errorMsg
      ? `Reconnecting to the mesh… last error: ${errorMsg}`
      : 'Reconnecting to the mesh…';
    return (
      <span
        title={tip}
        style={{
          fontSize: '0.7rem',
          padding: '0.1rem 0.4rem',
          borderRadius: 'var(--polly-radius-full)',
          background: 'var(--polly-status-warning-bg)',
          color: 'var(--polly-status-warning-text)',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        reconnecting…
      </span>
    );
  }
  if (state.kind === 'none') {
    return (
      <span
        title="No laptop is running `fairfox chat serve` on this mesh. Messages will pile up as pending until one starts."
        style={{
          fontSize: '0.7rem',
          padding: '0.1rem 0.4rem',
          borderRadius: 'var(--polly-radius-full)',
          background: 'var(--polly-status-warning-bg)',
          color: 'var(--polly-status-warning-text)',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        no relay
      </span>
    );
  }
  const r = state.relay;
  if (!r) {
    return null;
  }
  const ageMs = state.ageMs ?? 0;
  const errLabel = r.lastErrorKind ? ` · last error: ${r.lastErrorKind}` : '';
  const tooltip = `relay ${r.peerId.slice(0, 8)} · v${r.version}\nstarted ${r.startedAt}\nlast tick ${formatAge(ageMs)}\npending ${r.pending} · peers ${r.peers}${errLabel}`;
  if (state.kind === 'live') {
    return (
      <span
        title={tooltip}
        style={{
          fontSize: '0.7rem',
          padding: '0.1rem 0.4rem',
          borderRadius: 'var(--polly-radius-full)',
          background: r.lastErrorKind
            ? 'var(--polly-status-warning-bg)'
            : 'var(--polly-status-success-bg, #dcfce7)',
          color: r.lastErrorKind ? 'var(--polly-status-warning-text)' : '#166534',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        relay live{r.pending > 0 ? ` · ${r.pending} pending` : ''}
      </span>
    );
  }
  return (
    <span
      title={tooltip}
      style={{
        fontSize: '0.7rem',
        padding: '0.1rem 0.4rem',
        borderRadius: 'var(--polly-radius-full)',
        background: 'var(--polly-status-warning-bg)',
        color: 'var(--polly-status-warning-text)',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      relay {state.kind === 'stale' ? 'stale' : 'gone'} · {formatAge(ageMs)}
    </span>
  );
}

function ChatHeader({ chat }: { chat: Chat | undefined }) {
  const title = chat?.title ?? 'New chat';
  // Show the archive button only when there is an active chat to
  // archive — the empty "New chat" placeholder has nothing to act
  // on. Calls the existing `chat.archive` action which sets
  // archivedAt and hides the chat from the main thread; full
  // history is still reachable via /chat for now (rename if/when
  // a hard-delete affordance lands).
  return (
    <Layout
      columns={chat ? '1fr auto auto auto auto' : '1fr auto auto auto'}
      gap="0.35rem"
      alignItems="center"
    >
      <strong style={{ fontSize: '0.95rem' }}>{title}</strong>
      <RelayBadge />
      {chat ? (
        <Button
          label="Archive"
          tier="tertiary"
          size="small"
          data-action="chat.archive"
          data-action-id={chat.id}
          title="Archive this chat. It stays in /chat history but moves out of the widget."
        />
      ) : null}
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
    <Surface
      borderSides="block-start"
      border="default"
      padding="0.35rem 0"
      style={{ borderTopStyle: 'dashed' }}
    >
      <span style={{ fontSize: '0.7rem', color: 'var(--polly-text-muted)' }}>Claude Code:</span>
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
    </Surface>
  );
}

function DemoBanner() {
  if (!hasOverlay()) {
    return null;
  }
  return (
    <Surface
      variant="callout"
      background="var(--polly-status-warning-bg)"
      style={{
        color: 'var(--polly-status-warning-text)',
        '--polly-border': 'var(--polly-warning)',
        fontSize: '0.75rem',
        margin: '0.25rem 0',
      }}
    >
      ⚠ This widget contains demo data from <code>#__inject=</code> in the URL. None of it is real
      or synced to your other devices.
    </Surface>
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
  const sharedSurfaceProps = mobile
    ? {
        position: 'fixed' as const,
        inset: '0',
        radius: 'none' as const,
        border: 'none' as const,
        shadow: 'none' as const,
        background: 'raised' as const,
      }
    : {
        position: 'fixed' as const,
        inset: `auto 1rem ${BUTTON_SIZE + 20}px auto`,
        radius: 'lg' as const,
        border: 'default' as const,
        shadow: 'lg' as const,
        background: 'raised' as const,
        width: '380px',
      };
  return (
    <Surface
      {...sharedSurfaceProps}
      maxInlineSize={mobile ? undefined : '380px'}
      zIndex={9999}
      style={{
        maxHeight: mobile ? undefined : '70vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Surface borderSides="block-end" border="default" padding="0.75rem 1rem">
        <ChatHeader chat={chat} />
        <DemoBanner />
        <ChatContextStrip chat={chat} />
        <ActiveCcSessions />
      </Surface>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.5rem 1rem',
        }}
      >
        {messages.length === 0 ? (
          <p
            style={{
              color: 'var(--polly-text-muted)',
              fontSize: '0.85rem',
              margin: '0.5rem 0',
            }}
          >
            New thread. Type below — the laptop's <code>fairfox chat serve</code> will reply.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} selfDeviceId={selfPeerId} />)
        )}
      </div>
      <Surface borderSides="block-start" border="default" padding="0.75rem 1rem">
        <Composer selfPeerId={selfPeerId} />
      </Surface>
    </Surface>
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
