// Step 0c, check 3: a bare page, served over HTTPS from Fly, that two devices
// open to talk to each other by WebRTC, once by a straight path and once with
// the relay forced. It is a measurement and not the app's UI (A2). It has no
// sign-in, so the last deploy of step 0c removes this file, check3-page.ts and
// the setting FAIRFOX_TURN_SECRET (L2).
//
//   GET /check/3            the page
//   GET /check/3/ice        relay credentials, valid for one hour
//   WS  /check/3/ws?room=x&session=y
//                           passes each message to the other device in room x;
//                           answers a ping itself with a pong
//   POST /check/3/log       the page sends its log lines here
//   GET  /check/3/log       every device's log lines, oldest first, as text
import { createHmac } from 'node:crypto';
import { Elysia, t } from 'elysia';
import { CHECK3_PAGE } from './check3-page.ts';

/** The relay fairfox-turn: its dedicated IPv4 and port, from turn/fly.toml. */
export const RELAY = '213.188.221.129:3478';
const CREDENTIAL_SECONDS = 3600;
const ROOM_SIZE = 2;
/** The log is kept in memory only, and a deploy empties it. The oldest lines go first. */
const LOG_LINES = 5000;

/**
 * Credentials for coturn's use-auth-secret: the user name is the expiry time
 * in Unix seconds and a label, the password the Base64 HMAC-SHA1 of the user
 * name under the relay's shared secret. The same rule as scripts/audio.ts.
 */
export function turnCredentials(secret: string, now: Date): { username: string; credential: string } {
  const username = `${Math.floor(now.getTime() / 1000) + CREDENTIAL_SECONDS}:check3`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

type Socket = { id: string; send: (message: string) => unknown; close: () => unknown };

/** The owner's time, Berlin and Rome, as the page writes it: 11:35:50 CEST. */
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});
function stamp(now: Date): string {
  const parts = Object.fromEntries(clock.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}

export function check3Routes(turnSecret: string) {
  const rooms = new Map<string, Map<string, Socket>>();
  const logLines: string[] = [];
  const keep = (lines: string[]) => {
    logLines.push(...lines);
    logLines.splice(0, Math.max(0, logLines.length - LOG_LINES));
  };
  // The server's own lines: when each device's signalling socket opens and closes, as the server sees it.
  const serverLine = (room: string, session: string, text: string) =>
    keep([`server (room ${room}) ${session} ${stamp(new Date())} ${text}`]);
  return new Elysia()
    .post(
      '/check/3/log',
      ({ body }) => {
        const who = `${body.device || '?'} (${body.network}) ${body.session}`;
        keep(body.lines.map((line) => `${who} ${line}`));
        return new Response(null, { status: 204 });
      },
      {
        body: t.Object({
          session: t.String({ maxLength: 16 }),
          device: t.String({ maxLength: 32 }),
          network: t.String({ maxLength: 16 }),
          lines: t.Array(t.String({ maxLength: 500 }), { maxItems: 100 }),
        }),
      },
    )
    .get('/check/3/log', () => new Response(`${logLines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } }))
    .get('/check/3', () => new Response(CHECK3_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    .get('/check/3/ice', () => {
      const { username, credential } = turnCredentials(turnSecret, new Date());
      return {
        iceServers: [
          { urls: [`turn:${RELAY}?transport=udp`, `turn:${RELAY}?transport=tcp`], username, credential },
          { urls: `stun:${RELAY}` },
        ],
      };
    })
    .ws('/check/3/ws', {
      query: t.Object({
        room: t.String({ minLength: 1, maxLength: 32 }),
        session: t.Optional(t.String({ maxLength: 16 })),
      }),
      open(ws) {
        const { room: name, session = '?' } = ws.data.query;
        const room = rooms.get(name) ?? new Map<string, Socket>();
        if (room.size >= ROOM_SIZE) {
          serverLine(name, session, 'socket refused: the room is full');
          ws.send(JSON.stringify({ type: 'full' }));
          ws.close();
          return;
        }
        room.set(ws.id, ws);
        rooms.set(name, room);
        serverLine(name, session, `socket opened; others in the room: ${room.size - 1}`);
        ws.send(JSON.stringify({ type: 'joined', others: room.size - 1 }));
      },
      message(ws, message) {
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        if (text === '{"type":"ping"}') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        for (const [id, other] of rooms.get(ws.data.query.room) ?? []) {
          if (id !== ws.id) {
            other.send(text);
          }
        }
      },
      close(ws, code) {
        const { room: name, session = '?' } = ws.data.query;
        const room = rooms.get(name);
        const was = room?.delete(ws.id) ?? false;
        const others = [...(room?.values() ?? [])];
        // A socket the full room refused was never in it: the two in the call are not told it left.
        if (!was) {
          return;
        }
        serverLine(name, session, `socket closed (${code}); "left" sent to ${others.length}`);
        for (const other of others) {
          other.send(JSON.stringify({ type: 'left' }));
        }
        if (room?.size === 0) {
          rooms.delete(ws.data.query.room);
        }
      },
    });
}
