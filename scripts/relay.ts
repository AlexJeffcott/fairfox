import { $ } from 'bun';

// Base URL of the todo sub-app, including the /todo mount. Override via
// FAIRFOX_TODO_URL (or the legacy TODO_REMOTE_URL) if pointing at a staging
// or locally-running fairfox. The WS URL is derived from it directly:
// BASE_URL + "/ws?role=relay" already includes the mount.
const BASE_URL =
  process.env.FAIRFOX_TODO_URL ||
  process.env.TODO_REMOTE_URL ||
  'https://fairfox-production-8273.up.railway.app/todo';
const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/ws?role=relay`;
const CWD = process.env.RELAY_CWD || `${import.meta.dir}/../../`;
const MAX_HISTORY = 20;

let ws: WebSocket;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let processing = false;

async function getConversationHistory(conversationId: number): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/conversations/${conversationId}/messages`);
  const messages = (await res.json()) as Array<{ sender: string; text: string }>;
  const recent = messages.slice(-MAX_HISTORY);
  return recent.map((m) => `${m.sender === 'user' ? 'User' : 'Claude'}: ${m.text}`).join('\n\n');
}

async function getProjectContext(contextType: string, contextId: string): Promise<string> {
  if (!contextType || !contextId) {
    return '';
  }
  try {
    const res = await fetch(`${BASE_URL}/api/${contextType}/${contextId}`);
    if (!res.ok) {
      return '';
    }
    const data = await res.json();
    return `\n\nContext — ${contextType} ${contextId}:\n${JSON.stringify(data, null, 2)}`;
  } catch {
    return '';
  }
}

interface PendingMessage {
  id: number;
  conversation_id: number;
  text: string;
  conversation_title?: string;
  context_type?: string;
  context_id?: string;
}

async function processMessage(msg: PendingMessage): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;

  try {
    const { id, conversation_id, text, conversation_title, context_type, context_id } = msg;
    console.log(`[relay] processing message ${id}: "${text.slice(0, 80)}..."`);

    const history = await getConversationHistory(conversation_id);
    const projectContext = await getProjectContext(context_type ?? '', context_id ?? '');

    const prompt = [
      `You are responding in a chat conversation${conversation_title ? ` about "${conversation_title}"` : ''}.`,
      'The user is messaging from their phone. You have access to their laptop — files, git, commands.',
      `Keep responses concise and practical since they're reading on a small screen.`,
      projectContext,
      `\nConversation so far:\n${history}`,
      `\nRespond to the user's latest message. If they ask you to do something on the laptop, do it and report back.`,
    ]
      .filter(Boolean)
      .join('\n');

    const result = await $`cd ${CWD} && claude -p ${prompt} --dangerously-skip-permissions`.text();
    const response = result.trim();
    console.log(`[relay] response: "${response.slice(0, 80)}..."`);

    await fetch(`${BASE_URL}/api/conversations/${conversation_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'claude', text: response }),
    });
    await fetch(`${BASE_URL}/api/messages/${id}/responded`, { method: 'POST' });

    console.log(`[relay] done processing message ${id}`);
  } catch (e) {
    console.error('[relay] error processing message:', e);
  } finally {
    processing = false;
  }
}

async function checkPending(): Promise<void> {
  try {
    const pending = (await fetch(`${BASE_URL}/api/messages/pending`).then((r) =>
      r.json()
    )) as PendingMessage[];
    for (const msg of pending) {
      await processMessage(msg);
    }
  } catch (e) {
    console.error('[relay] error checking pending:', e);
  }
}

function connect(): void {
  console.log(`[relay] connecting to ${WS_URL}`);
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    console.log('[relay] connected');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    checkPending();
  });

  ws.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(String(event.data)) as {
        type: string;
        message?: { id: number; sender: string; pending: number };
      };
      if (data.type === 'new_message' && data.message?.sender === 'user' && data.message.pending) {
        const pending = (await fetch(`${BASE_URL}/api/messages/pending`).then((r) =>
          r.json()
        )) as PendingMessage[];
        const msg = pending.find((m) => m.id === data.message?.id);
        if (msg) {
          await processMessage(msg);
        }
      }
    } catch (e) {
      console.error('[relay] error handling WS message:', e);
    }
  });

  ws.addEventListener('close', () => {
    console.log('[relay] disconnected, reconnecting in 3s');
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.addEventListener('error', (e) => {
    console.error('[relay] WebSocket error:', e);
  });
}

connect();

setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);

console.log('[relay] daemon started. Ctrl+C to stop.');
