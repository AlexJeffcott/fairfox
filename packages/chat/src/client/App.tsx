/** @jsxImportSource preact */
// Chat sub-app — one household thread visible to every paired device.
// Each message is attributed by user + device so interleaved asks stay
// readable. A message can carry a per-message contextRef; the
// laptop-side `fairfox chat serve` picks that up and injects the
// referenced sub-app doc into the prompt.

import { ActionInput, Badge, Button, Layout } from '@fairfox/polly/ui';
import { devicesState } from '@fairfox/shared/devices-state';
import { HubBack } from '@fairfox/shared/hub-back';
import { userIdentity } from '@fairfox/shared/user-identity-state';
import { usersState } from '@fairfox/shared/users-state';
import type { Message } from '#src/client/state.ts';
import { chatState, messageDraft } from '#src/client/state.ts';

const CONTEXT_KIND_OPTIONS = ['', 'project', 'task', 'agenda', 'doc'] as const;

const SELECT_STYLE = {
  padding: '0.35rem',
  border: '1px solid var(--polly-border)',
  borderRadius: '4px',
  fontSize: 'var(--polly-text-sm)',
};

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
  return deviceId;
}

function formatTime(iso: string): string {
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

function MessageRow({ message, selfDeviceId }: { message: Message; selfDeviceId: string | null }) {
  const isAssistant = message.sender === 'assistant';
  const isSelf = !isAssistant && message.senderDeviceId === selfDeviceId;
  // Hard-coded readable palette rather than polly vars that don't
  // cover "muted surface for assistant" / "soft primary for self" in
  // every theme. Earlier the assistant bubble inherited white text
  // on an almost-white background, which is the report.
  const bg = isAssistant ? '#e8edf3' : isSelf ? '#dbeafe' : '#ffffff';
  const fg = '#1c1917';
  const border = isAssistant ? '#c6cfd9' : isSelf ? '#bcd5f5' : '#e7e5e4';
  const label = isAssistant
    ? 'Claude'
    : `${displayNameFor(message.senderUserId)} · ${deviceNameFor(message.senderDeviceId)}`;
  return (
    <Layout
      rows="auto auto"
      gap="var(--polly-space-xs)"
      padding="var(--polly-space-sm) var(--polly-space-md)"
    >
      <Layout columns="auto 1fr auto auto" gap="var(--polly-space-sm)" alignItems="center">
        <strong
          style={{
            fontSize: 'var(--polly-text-sm)',
            color: isAssistant ? 'var(--polly-success)' : 'var(--polly-text)',
          }}
        >
          {label}
        </strong>
        <span
          style={{
            fontSize: 'var(--polly-text-sm)',
            color: 'var(--polly-text-muted)',
          }}
        >
          {formatTime(message.createdAt)}
        </span>
        {message.contextRef && (
          <Badge variant="info">
            {message.contextRef.kind}:{message.contextRef.id}
          </Badge>
        )}
        {message.pending && !isAssistant && <Badge variant="warning">pending</Badge>}
      </Layout>
      <div
        style={{
          background: bg,
          color: fg,
          border: `1px solid ${border}`,
          padding: 'var(--polly-space-sm) var(--polly-space-md)',
          borderRadius: '6px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 'var(--polly-text-base)',
        }}
      >
        {message.text}
      </div>
      {message.pending && !isAssistant && (
        <Layout columns="auto auto" gap="var(--polly-space-xs)">
          <Button
            label="Cancel"
            tier="tertiary"
            size="small"
            data-action="chat.cancel-pending"
            data-action-id={message.id}
          />
          <Button
            label="Delete"
            tier="tertiary"
            size="small"
            color="danger"
            data-action="chat.delete"
            data-action-id={message.id}
          />
        </Layout>
      )}
    </Layout>
  );
}

function Composer({ selfPeerId }: { selfPeerId: string | null }) {
  const draft = messageDraft.value;
  const identity = userIdentity.value;
  if (!identity) {
    return (
      <p style={{ color: 'var(--polly-text-muted)', fontSize: 'var(--polly-text-sm)' }}>
        Connect your identity on the hub Peers tab before sending messages.
      </p>
    );
  }
  if (!selfPeerId) {
    return null;
  }
  return (
    <Layout rows="auto auto" gap="var(--polly-space-xs)">
      <Layout columns="auto auto auto" gap="var(--polly-space-xs)" alignItems="center">
        <span style={{ fontSize: 'var(--polly-text-sm)', color: 'var(--polly-text-muted)' }}>
          Context
        </span>
        <select
          value={draft.contextKind}
          data-action="chat.draft-kind"
          style={SELECT_STYLE}
          aria-label="Context kind"
        >
          {CONTEXT_KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k === '' ? '(none)' : k}
            </option>
          ))}
        </select>
        {draft.contextKind !== '' && (
          <ActionInput
            value={draft.contextId}
            variant="single"
            action="chat.draft-id"
            saveOn="blur"
            placeholder="id (e.g. P01, T42, 38)"
            ariaLabel="Context id"
          />
        )}
      </Layout>
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <ActionInput
          value={draft.text}
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

export function App() {
  const messages = chatState.value.messages
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Derive this browser's device id from the devicesState + local
  // userIdentity: the device row whose ownerUserIds includes the
  // local user's id. Good enough for the "this is me" highlight;
  // falls back to null when the gate isn't fully satisfied yet.
  const identity = userIdentity.value;
  let selfPeerId: string | null = null;
  if (identity) {
    for (const [peerId, entry] of Object.entries(devicesState.value.devices)) {
      if ((entry.ownerUserIds ?? []).includes(identity.userId)) {
        selfPeerId = peerId;
        break;
      }
    }
  }
  return (
    <Layout rows="auto 1fr auto" gap="var(--polly-space-md)" padding="var(--polly-space-lg)">
      <Layout columns="1fr auto" gap="var(--polly-space-sm)" alignItems="center">
        <h1 style={{ margin: 0 }}>Chat</h1>
        <HubBack />
      </Layout>
      <div style={{ overflowY: 'auto' }}>
        <Layout rows="auto" gap="var(--polly-space-xs)">
          {messages.length === 0 ? (
            <p style={{ color: 'var(--polly-text-muted)' }}>
              No messages yet. Start the thread below — the laptop's
              <code style={{ margin: '0 0.25rem' }}>fairfox chat serve</code>
              picks up pending user messages and writes Claude's reply.
            </p>
          ) : (
            messages.map((m) => <MessageRow key={m.id} message={m} selfDeviceId={selfPeerId} />)
          )}
        </Layout>
      </div>
      <Composer selfPeerId={selfPeerId} />
    </Layout>
  );
}
