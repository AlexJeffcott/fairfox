// The werift side of the check 3 routes: relay credentials from
// /check/3/ice, and a room on /check/3/ws that carries offers, answers and
// candidates between two ends. The bare page speaks the same messages, so a
// script and a browser can meet in one room (checks 2 and 4).
import { within } from './webrtc.ts';

export type Candidate = { candidate: string; sdpMid?: string; sdpMLineIndex?: number };

export type Message =
  | { type: 'joined'; others: number }
  | { type: 'hello' }
  | { type: 'left' }
  | { type: 'full' }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: Candidate }
  | { type: 'done'; packets: number; sha256: string };

function parseCandidate(value: unknown): Candidate {
  const field = (key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined);
  const mid = field('sdpMid');
  const index = field('sdpMLineIndex');
  return {
    candidate: String(field('candidate')),
    ...(typeof mid === 'string' ? { sdpMid: mid } : {}),
    ...(typeof index === 'number' ? { sdpMLineIndex: index } : {}),
  };
}

export function parse(data: unknown): Message {
  const value: unknown = JSON.parse(String(data));
  if (typeof value !== 'object' || value === null || typeof Reflect.get(value, 'type') !== 'string') {
    throw new Error(`Not a message: ${String(data)}`);
  }
  const type: unknown = Reflect.get(value, 'type');
  const text = (key: string) => String(Reflect.get(value, key));
  const count = (key: string) => Number(Reflect.get(value, key));
  switch (type) {
    case 'joined':
      return { type, others: count('others') };
    case 'hello':
      return { type };
    case 'left':
      return { type };
    case 'full':
      return { type };
    case 'offer':
      return { type, sdp: text('sdp') };
    case 'answer':
      return { type, sdp: text('sdp') };
    case 'candidate':
      return { type, candidate: parseCandidate(Reflect.get(value, 'candidate')) };
    case 'done':
      return { type, packets: count('packets'), sha256: text('sha256') };
    default:
      throw new Error(`Unknown message type: ${String(type)}`);
  }
}

function isType<T extends Message['type']>(message: Message, type: T): message is Extract<Message, { type: T }> {
  return message.type === type;
}

/**
 * The relay by UDP, with its credentials, as werift takes them. The server
 * also lists the relay by TCP and a STUN address; werift reads one URL for
 * each entry, and these checks use UDP.
 */
export async function relayServers(origin: string): Promise<{ urls: string; username: string; credential: string }[]> {
  const body: unknown = await (await fetch(`${origin}/check/3/ice`)).json();
  const servers: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'iceServers') : undefined;
  if (!Array.isArray(servers)) {
    throw new Error(`${origin}/check/3/ice gave no iceServers.`);
  }
  return servers
    .map((entry: unknown) => ({
      urls: String(Reflect.get(Object(entry), 'urls')).split(',')[0] ?? '',
      username: String(Reflect.get(Object(entry), 'username')),
      credential: String(Reflect.get(Object(entry), 'credential')),
    }))
    .filter((server) => server.urls.startsWith('turn:'));
}

/** One end's connection to a room. Candidates go to `onCandidate` as they come; every other message waits in order. */
export class Room {
  private readonly inbox: Message[] = [];
  private readonly waiting: ((m: Message) => void)[] = [];
  onCandidate: (candidate: Candidate) => void = () => {};

  private constructor(
    private readonly socket: WebSocket,
    readonly name: string,
  ) {
    socket.onmessage = (event) => {
      const message = parse(event.data);
      if (message.type === 'candidate') {
        this.onCandidate(message.candidate);
        return;
      }
      const next = this.waiting.shift();
      if (next === undefined) {
        this.inbox.push(message);
      } else {
        next(message);
      }
    };
    socket.onclose = () => console.log('signalling closed');
  }

  static async join(origin: string, name: string): Promise<Room> {
    const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/check/3/ws?room=${encodeURIComponent(name)}`);
    await within(10_000, 'opening the signalling socket', new Promise((open) => socket.addEventListener('open', open)));
    return new Room(socket, name);
  }

  send(message: Message): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  private next(): Promise<Message> {
    const queued = this.inbox.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((deliver) => this.waiting.push(deliver));
  }

  /** The next message of one of `types`; others are logged and dropped. */
  async expect<T extends Message['type']>(types: readonly T[], ms: number): Promise<Extract<Message, { type: T }>> {
    for (;;) {
      const message = await within(ms, `waiting for ${types.join(' or ')}`, this.next());
      if (message.type === 'full') {
        throw new Error(`Room ${this.name} is full: two ends are in it.`);
      }
      for (const type of types) {
        if (isType(message, type)) {
          return message;
        }
      }
      console.log(`(${message.type})`);
    }
  }
}
