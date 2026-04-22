// `fairfox agenda list` / `fairfox agenda add <name>` — read and write
// the agenda $meshState document from the CLI.
//
// The $meshState signal is configured by createMeshClient internally,
// so the subcommands only have to open the client, wait for a peer to
// be visible (otherwise there's nothing to sync against), and then
// read or mutate the signal. Mutations are followed by a short flush
// interval so the Automerge sync messages have a chance to reach the
// peer before the process exits.
//
// Types mirror packages/agenda/src/client/state.ts. A small duplication
// is the price of keeping the CLI free of the Preact-flavoured runtime
// that sub-app would drag along; shared structural types live in the
// CRDT document itself, not in a typings package.

import { $meshState } from '@fairfox/shared/polly';
import {
  derivePeerId,
  flushOutgoing,
  keyringStorage,
  openMeshClient,
  waitForPeer,
} from '#src/mesh.ts';

type AgendaItemKind = 'event' | 'chore';
type RecurrenceType = 'once' | 'daily' | 'weekdays' | 'interval';

interface AgendaItem {
  [key: string]: unknown;
  id: string;
  kind: AgendaItemKind;
  name: string;
  room?: string;
  time?: string;
  recurrence: RecurrenceType;
  recurrenceDays?: boolean[];
  recurrenceInterval?: number;
  onceDate?: string;
  points: number;
  active: boolean;
}

interface Completion {
  [key: string]: unknown;
  id: string;
  itemId: string;
  person: string;
  kind: 'done' | 'snooze-1d' | 'snooze-3d' | 'snooze-7d';
  completedAt: string;
}

interface AgendaDoc {
  [key: string]: unknown;
  items: AgendaItem[];
  completions: Completion[];
}

const INITIAL: AgendaDoc = { items: [], completions: [] };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadOwnPeerId(): Promise<string> {
  const storage = keyringStorage();
  const keyring = await storage.load();
  if (!keyring) {
    throw new Error('no keyring — run `fairfox pair <token>` first');
  }
  return derivePeerId(keyring.identity.publicKey);
}

export async function agendaList(): Promise<number> {
  const peerId = await loadOwnPeerId();
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    if (!peered) {
      process.stderr.write(
        'fairfox agenda list: no mesh peers reachable — showing the local copy (may be stale).\n'
      );
    }
    // A fresh $meshState with the same logical key yields the same
    // deterministic DocumentId on every peer. `loaded` resolves once the
    // document handle exists; the actual converged state arrives through
    // the sync handshake a moment later, so give it a brief settle
    // window before reading.
    const agenda = $meshState<AgendaDoc>('agenda:main', INITIAL);
    await agenda.loaded;
    if (peered) {
      await flushOutgoing(2000);
    }
    const doc = agenda.value;
    if (doc.items.length === 0) {
      process.stdout.write('(empty)\n');
      return 0;
    }
    for (const item of doc.items) {
      const marker = item.kind === 'event' ? '[event]' : '[chore]';
      const recurrence = item.recurrence === 'once' ? '' : ` (${item.recurrence})`;
      process.stdout.write(`${marker} ${item.name}${recurrence}\n`);
    }
    return 0;
  } finally {
    await client.close();
  }
}

export async function agendaAdd(name: string): Promise<number> {
  const peerId = await loadOwnPeerId();
  const client = await openMeshClient({ peerId });
  try {
    const peered = await waitForPeer(client, 8000);
    if (!peered) {
      process.stderr.write(
        'fairfox agenda add: no mesh peers reachable — writing locally; other devices will pick this up when they next connect.\n'
      );
    }
    const agenda = $meshState<AgendaDoc>('agenda:main', INITIAL);
    await agenda.loaded;
    const item: AgendaItem = {
      id: generateId(),
      kind: 'chore',
      name,
      recurrence: 'daily',
      points: 1,
      active: true,
    };
    agenda.value = {
      ...agenda.value,
      items: [...agenda.value.items, item],
    };
    await flushOutgoing();
    process.stdout.write(`added: ${name}\n`);
    return 0;
  } finally {
    await client.close();
  }
}
