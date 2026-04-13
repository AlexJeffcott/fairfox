import type { ServerWebSocket } from 'bun';

interface Client {
  ws: ServerWebSocket<{ role: string }>;
  role: string;
}

const clients = new Set<Client>();

export function addClient(ws: ServerWebSocket<{ role: string }>, role: string) {
  clients.add({ ws, role });
}

export function removeClient(ws: ServerWebSocket<{ role: string }>) {
  for (const client of clients) {
    if (client.ws === ws) {
      clients.delete(client);
      break;
    }
  }
}

export function broadcast(data: any) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    try {
      client.ws.send(msg);
    } catch {
      clients.delete(client);
    }
  }
}

export function getClientCount() {
  return clients.size;
}

export function hasRelay() {
  for (const client of clients) {
    if (client.role === 'relay') return true;
  }
  return false;
}
