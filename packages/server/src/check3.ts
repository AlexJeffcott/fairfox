// Step 0c, check 3: a bare page, served over HTTPS from Fly, that two devices
// open to talk to each other by WebRTC, once by a straight path and once with
// the relay forced. It is a measurement and not the app's UI (A2). It has no
// sign-in, so the last deploy of step 0c removes this file, check3-page.ts and
// the setting FAIRFOX_TURN_SECRET (L2).
//
//   GET /check/3            the page
//   GET /check/3/ice        relay credentials, valid for one hour
//   WS  /check/3/ws?room=x  passes each message to the other device in room x
import { createHmac } from 'node:crypto';
import { Elysia, t } from 'elysia';
import { CHECK3_PAGE } from './check3-page.ts';

/** The relay fairfox-turn: its dedicated IPv4 and port, from turn/fly.toml. */
const RELAY = '213.188.221.129:3478';
const CREDENTIAL_SECONDS = 3600;
const ROOM_SIZE = 2;

/**
 * Credentials for coturn's use-auth-secret: the user name is the expiry time
 * in Unix seconds and a label, the password the Base64 HMAC-SHA1 of the user
 * name under the relay's shared secret. The same rule as scripts/audio.ts.
 */
function turnCredentials(secret: string, now: Date): { username: string; credential: string } {
  const username = `${Math.floor(now.getTime() / 1000) + CREDENTIAL_SECONDS}:check3`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

type Socket = { id: string; send: (message: string) => unknown; close: () => unknown };

export function check3Routes(turnSecret: string) {
  const rooms = new Map<string, Map<string, Socket>>();
  return new Elysia()
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
      query: t.Object({ room: t.String({ minLength: 1, maxLength: 32 }) }),
      open(ws) {
        const room = rooms.get(ws.data.query.room) ?? new Map<string, Socket>();
        if (room.size >= ROOM_SIZE) {
          ws.send(JSON.stringify({ type: 'full' }));
          ws.close();
          return;
        }
        room.set(ws.id, ws);
        rooms.set(ws.data.query.room, room);
        ws.send(JSON.stringify({ type: 'joined', others: room.size - 1 }));
      },
      message(ws, message) {
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        for (const [id, other] of rooms.get(ws.data.query.room) ?? []) {
          if (id !== ws.id) {
            other.send(text);
          }
        }
      },
      close(ws) {
        const room = rooms.get(ws.data.query.room);
        room?.delete(ws.id);
        for (const other of room?.values() ?? []) {
          other.send(JSON.stringify({ type: 'left' }));
        }
        if (room?.size === 0) {
          rooms.delete(ws.data.query.room);
        }
      },
    });
}
