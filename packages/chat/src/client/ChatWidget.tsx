/** @jsxImportSource preact */
// ChatWidget — the always-mounted floating assistant. Collapsed it
// renders a single bottom-right button; expanded it's a full-screen
// modal on mobile and a docked panel on wider screens. Shows the
// active chat's message tail, a composer with the live page context
// chip, and a small header with new / close controls.

import {
  ActionInput,
  Badge,
  Button,
  Cluster,
  Code,
  Layout,
  Surface,
  Text,
} from '@fairfox/polly/ui';
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
    <Surface as="span" variant="chip" maxInlineSize="100%" background="var(--polly-status-info-bg)">
      <Cluster gap="0.35rem" inline={true}>
        <Code>{ctx.kind}</Code>
        <Text size="sm" data-polly-truncate={true}>
          {ctx.label}
        </Text>
        {onDetachAction && (
          <Button
            tier="tertiary"
            size="small"
            label="×"
            data-action={onDetachAction}
            data-action-kind={ctx.kind}
            data-action-id={ctx.id ?? ''}
            data-action-key={`${ctx.kind}:${ctx.id ?? ''}`}
            aria-label={`Remove ${ctx.label}`}
          />
        )}
      </Cluster>
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
    >
      <Layout height="100%" alignItems="center" justifyItems="center">
        <Text as="span" size="lg" aria-hidden={true}>
          💬
        </Text>
      </Layout>
      {pending && (
        <Surface
          as="span"
          radius="full"
          background="var(--polly-danger)"
          border="strong"
          borderWidth="medium"
          width="12px"
          height="12px"
          position="fixed"
          inset={`auto calc(1rem - 4px) calc(1rem + ${BUTTON_SIZE - 8}px) auto`}
          zIndex={9999}
          aria-hidden={true}
          // Retint the strong-border token to the accent colour so the
          // ring reads as a cutout against the accent-coloured button.
          style={{ '--polly-border-strong': 'var(--polly-accent)' }}
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
        <Text as="strong" size="xs" weight="bold">
          {label}
        </Text>
        <span />
        <Text as="span" size="xs" tone="muted">
          {formatTime(message.createdAt)}
          {message.pending && !isAssistant && ' · pending'}
        </Text>
      </Layout>
      <Surface
        variant="bubble"
        background={bg}
        style={{
          // Bubble backgrounds are hardcoded light (#ffffff,
          // #e8edf3, #dbeafe, #fef3c7); the text colour must be
          // hardcoded dark too — reading var(--polly-text) made
          // white-on-white when the user agent's polly theme
          // resolved that variable to a near-white value. Retint
          // the polly tokens so the bubble owns its own dark text
          // and per-sender border without an inline colour rule.
          '--polly-text': '#1c1917',
          '--polly-border': border,
        }}
      >
        <Layout rows="auto" gap="0">
          {message.text.split('\n').map((line, i) => {
            // Splitting on newline restores the pre-wrap behaviour
            // the old inline style gave the bubble. The index is a
            // stable key: a message's text is immutable, so the
            // lines never reorder or change count.
            const lineKey = `${message.id}:${i}`;
            return (
              <Text key={lineKey} as="p" size="sm">
                {line === '' ? ' ' : line}
              </Text>
            );
          })}
        </Layout>
      </Surface>
      {isAssistant && (message.model || message.costUsd !== undefined || message.error) ? (
        <Cluster gap="0.5rem">
          {message.model ? (
            <Text size="xs" tone="muted">
              {shortModel(message.model)}
            </Text>
          ) : null}
          {message.costUsd !== undefined && message.costUsd > 0 ? (
            <Text size="xs" tone="muted">
              ${message.costUsd.toFixed(4)}
            </Text>
          ) : null}
          {message.durationMs === undefined ? null : (
            <Text size="xs" tone="muted">
              {Math.round(message.durationMs / 100) / 10}s
            </Text>
          )}
          {message.error ? <Badge variant="warning">error: {message.error.kind}</Badge> : null}
          {message.error && message.parentId ? (
            <Button
              tier="tertiary"
              color="warning"
              size="small"
              label="↻ regenerate"
              data-action="chat.regenerate"
              data-action-id={message.id}
              aria-label="Regenerate this reply"
            />
          ) : null}
        </Cluster>
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
      <Surface as="p" padding="0.5rem">
        <Text tone="muted" size="sm">
          Connect your identity on the hub's Peers tab before sending messages.
        </Text>
      </Surface>
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
        <Surface
          as="p"
          variant="callout"
          background="var(--polly-status-warning-bg)"
          style={{ '--polly-text': 'var(--polly-status-warning-text)' }}
        >
          <Text size="sm">
            Setting up this device — your endorsement hasn't replicated yet. Reload to repair.
          </Text>
        </Surface>
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
        <Layout columns="auto 1fr" gap="0.35rem" alignItems="center">
          <Text size="xs" tone="muted">
            {pinned ? 'Pinned:' : 'Context:'}
          </Text>
          {live ? (
            <ContextChip ctx={live} />
          ) : (
            <Text size="xs" tone="muted">
              (none)
            </Text>
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
      <span title={tip}>
        <Badge variant="warning">reconnecting…</Badge>
      </span>
    );
  }
  if (state.kind === 'none') {
    return (
      <span title="No laptop is running `fairfox chat serve` on this mesh. Messages will pile up as pending until one starts.">
        <Badge variant="warning">no relay</Badge>
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
      <span title={tooltip}>
        <Badge variant={r.lastErrorKind ? 'warning' : 'success'}>
          relay live{r.pending > 0 ? ` · ${r.pending} pending` : ''}
        </Badge>
      </span>
    );
  }
  return (
    <span title={tooltip}>
      <Badge variant="warning">
        relay {state.kind === 'stale' ? 'stale' : 'gone'} · {formatAge(ageMs)}
      </Badge>
    </span>
  );
}

function ChatHeader({ chat }: { chat: Chat | undefined }) {
  const title = chat?.title ?? 'New chat';
  // Two rows so the header survives a 350px phone: the title (which
  // truncates rather than pushing the panel wider) sits beside the
  // Close button, and the relay badge plus the chat-action buttons
  // sit on a wrap-capable strip below. The archive button only
  // appears when there is an active chat to archive — the empty
  // "New chat" placeholder has nothing to act on.
  return (
    <Layout rows="auto auto" gap="0.4rem">
      <Layout columns="1fr auto" gap="0.5rem" alignItems="center">
        <Text as="strong" size="md" weight="bold" data-polly-truncate={true}>
          {title}
        </Text>
        <Button label="Close" tier="tertiary" size="small" data-action="chat.close-widget" />
      </Layout>
      <Layout
        columns={chat ? 'auto auto auto' : 'auto auto'}
        gap="0.35rem"
        alignItems="center"
        justifyContent="start"
      >
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
      </Layout>
    </Layout>
  );
}

function ChatContextStrip({ chat }: { chat: Chat | undefined }) {
  if (!chat || chat.contextRefs.length === 0) {
    return null;
  }
  return (
    <Cluster gap="0.35rem" padding="0.25rem 0">
      <Text size="xs" tone="muted">
        Following:
      </Text>
      {chat.contextRefs.map((ctx) => {
        const key = `${ctx.kind}:${ctx.id ?? ''}`;
        return (
          <Cluster key={key} gap="0.25rem" inline={true}>
            <ContextChip ctx={ctx} />
            <Button
              tier="tertiary"
              size="small"
              label="×"
              data-action="chat.remove-context"
              data-action-chat-id={chat.id}
              data-action-key={key}
              aria-label={`Remove ${ctx.label} from this chat`}
            />
          </Cluster>
        );
      })}
    </Cluster>
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
    <Surface borderSides="block-start" border="default" padding="0.35rem 0">
      <Text size="xs" tone="muted">
        Claude Code:
      </Text>
      {sessions.map((s) => {
        const leaf = `${s.cwd}`.split('/').slice(-2).join('/');
        const state = s.state;
        const isDemo = demoIds.has(`${s.sessionId}`);
        return (
          <Layout
            key={`${s.sessionId}`}
            columns="1fr auto"
            gap="0.5rem"
            justifyContent="space-between"
          >
            <span title={`${s.cwd}`}>
              <Text size="xs" tone={s.stale ? 'muted' : 'default'}>
                {leaf}
                {isDemo ? ' · demo' : ''}
              </Text>
            </span>
            <Text size="xs" tone="muted">
              {state}
              {s.lastToolName ? ` · ${s.lastToolName}` : ''}
            </Text>
          </Layout>
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
        '--polly-text': 'var(--polly-status-warning-text)',
        '--polly-border': 'var(--polly-warning)',
      }}
    >
      <Text size="xs">
        ⚠ This widget contains demo data from <Code>#__inject=</Code> in the URL. None of it is real
        or synced to your other devices.
      </Text>
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
        height: '100%',
      }
    : {
        position: 'fixed' as const,
        inset: `auto 1rem ${BUTTON_SIZE + 20}px auto`,
        radius: 'lg' as const,
        border: 'default' as const,
        shadow: 'lg' as const,
        background: 'raised' as const,
        width: '380px',
        height: '70vh',
      };
  return (
    <Surface {...sharedSurfaceProps} maxInlineSize={mobile ? undefined : '380px'} zIndex={9999}>
      <Layout rows="auto 1fr auto" height="100%">
        <Surface borderSides="block-end" border="default" padding="0.75rem 1rem">
          <ChatHeader chat={chat} />
          <DemoBanner />
          <ChatContextStrip chat={chat} />
          <ActiveCcSessions />
        </Surface>
        {/* The message tail is the one region in this package that
          must scroll independently of the panel. polly 0.72.0 ships
          no overflow/scroll primitive and no token for it, so this
          is the single unavoidable inline style left in the
          package: `overflow-y: auto` cannot be expressed through a
          Surface prop or a --polly-* retint. Dropping it would clip
          long threads inside the fixed-height panel with no way to
          reach the older messages. */}
        <Surface padding="0.5rem 1rem" style={{ overflowY: 'auto' }}>
          {messages.length === 0 ? (
            <Text as="p" tone="muted" size="sm">
              New thread. Type below — the laptop's <Code>fairfox chat serve</Code> will reply.
            </Text>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} selfDeviceId={selfPeerId} />)
          )}
        </Surface>
        <Surface borderSides="block-start" border="default" padding="0.75rem 1rem">
          <Composer selfPeerId={selfPeerId} />
        </Surface>
      </Layout>
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
