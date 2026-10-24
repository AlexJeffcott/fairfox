// Step 0c, check 7: send a push to the page on the iPhone's home screen. The
// page (/check/7/app) subscribes and gives its subscription to the server;
// this script reads the newest one and sends to it from the laptop, which
// holds the private key. The push is encrypted as RFC 8291 says (aes128gcm)
// and signed as RFC 8292 says (VAPID), with WebCrypto only: no library.
//
//   bun scripts/check-7-push.ts --make-keys ~/.config/fairfox/check7-push-key.json
//       writes a new key pair and prints the public key for
//       FAIRFOX_CHECK7_PUSH_KEY in fly.toml
//   bun scripts/check-7-push.ts --keys ~/.config/fairfox/check7-push-key.json \
//       --origin https://fairfox.fly.dev --body "Push 1"
//       sends one push to the newest subscription and prints the push
//       service's answer
//   bun scripts/check-7-push.ts --self-test
//       encrypts a message to a key pair of its own and decrypts it again
//
// What the phone does is read from the phone and from /check/3/log, where the
// service worker writes a line for each push it receives.
import { chmod } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'make-keys': { type: 'string' },
    keys: { type: 'string' },
    origin: { type: 'string' },
    body: { type: 'string' },
    'self-test': { type: 'boolean', default: false },
  },
});

/** Bytes backed by a plain ArrayBuffer: what WebCrypto takes. */
type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const base64url = (bytes: Bytes): string => Buffer.from(bytes).toString('base64url');
const fromBase64url = (text: string): Bytes => new Uint8Array(Buffer.from(text, 'base64url'));
const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** The content key and nonce of RFC 8291, section 3.4, from the ECDH secret and both public keys. */
async function contentKeys(secret: Bytes, auth: Bytes, receiver: Bytes, sender: Bytes, salt: Bytes) {
  const ikm = await hkdf(auth, secret, concat(encoder.encode('WebPush: info\0'), receiver, sender), 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  return { key: await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt', 'decrypt']), nonce };
}

async function ecdh(privateKey: CryptoKey, publicRaw: Bytes): Promise<Bytes> {
  const publicKey = await crypto.subtle.importKey('raw', publicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256));
}

/** One record of aes128gcm: salt, record size, the sender's public key, then the ciphertext of the message and its delimiter 2. */
async function encrypt(message: Bytes, receiver: Bytes, auth: Bytes): Promise<Bytes> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sender = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { key, nonce } = await contentKeys(await ecdh(pair.privateKey, receiver), auth, receiver, sender, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(message, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = sender.length;
  return concat(header, sender, cipher);
}

async function decrypt(body: Bytes, receiverPrivate: CryptoKey, receiver: Bytes, auth: Bytes): Promise<Bytes> {
  const salt = body.slice(0, 16);
  const idLength = body[20] ?? 0;
  const sender = body.slice(21, 21 + idLength);
  const { key, nonce } = await contentKeys(await ecdh(receiverPrivate, sender), auth, receiver, sender, salt);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idLength)));
  const end = plain.lastIndexOf(2);
  if (end < 0) {
    throw new Error('No record delimiter in the decrypted message.');
  }
  return plain.slice(0, end);
}

/** The VAPID header: a JWT signed with ES256 for the push service's origin, and the public key. */
async function vapid(endpoint: string, privateKey: CryptoKey, publicRaw: Bytes, subject: string): Promise<string> {
  const part = (value: object) => base64url(encoder.encode(JSON.stringify(value)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part(claims)}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${base64url(signature)}, k=${base64url(publicRaw)}`;
}

type Keys = { privateKey: CryptoKey; publicRaw: Bytes };

async function readKeys(path: string): Promise<Keys> {
  const file: unknown = await Bun.file(path).json();
  const text = (key: string): string => {
    const value = typeof file === 'object' && file !== null ? Reflect.get(file, key) : undefined;
    return typeof value === 'string' ? value : '';
  };
  const jwk = { kty: text('kty'), crv: text('crv'), d: text('d'), x: text('x'), y: text('y') };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicRaw = concat(new Uint8Array([4]), fromBase64url(jwk.x), fromBase64url(jwk.y));
  if (publicRaw.length !== 65) {
    throw new Error(`${path} holds no P-256 key with x and y.`);
  }
  return { privateKey, publicRaw };
}

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const stamp = () => {
  const parts = Object.fromEntries(clock.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
};

const makeKeys = values['make-keys'];
if (makeKeys !== undefined) {
  if (await Bun.file(makeKeys).exists()) {
    throw new Error(`${makeKeys} exists. A new key pair ends every subscription made with the old one; remove the file first.`);
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  await Bun.write(makeKeys, JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)));
  await chmod(makeKeys, 0o600);
  console.log(base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))));
} else if (values['self-test']) {
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const receiverRaw = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = encoder.encode(JSON.stringify({ title: 'Check 7', body: 'self-test' }));
  const back = await decrypt(await encrypt(message, receiverRaw, auth), receiver.privateKey, receiverRaw, auth);
  if (base64url(back) !== base64url(message)) {
    throw new Error('check 7 self-test: the decrypted message differs from the one sent.');
  }
  // RFC 8291, appendix A: the receiver's keys and the message, decrypted by the same code.
  const rfc = {
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    receiver: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  };
  const receiverRawRfc = fromBase64url(rfc.receiver);
  const receiverPrivate = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: rfc.receiverPrivate, x: base64url(receiverRawRfc.slice(1, 33)), y: base64url(receiverRawRfc.slice(33)) },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const text = new TextDecoder().decode(await decrypt(fromBase64url(rfc.body), receiverPrivate, receiverRawRfc, fromBase64url(rfc.auth)));
  if (text !== 'When I grow up, I want to be a watermelon') {
    throw new Error(`check 7 self-test: RFC 8291's example decrypts to ${JSON.stringify(text)}.`);
  }
  console.log("check 7 self-test: green. A message makes the round trip, and RFC 8291's example decrypts.");
} else {
  const keysPath = values.keys;
  const origin = values.origin;
  const body = values.body;
  if (keysPath === undefined || origin === undefined || body === undefined) {
    throw new Error('Give --keys, --origin and --body; or --make-keys; or --self-test. None has a default.');
  }
  const keys = await readKeys(keysPath);
  const listed: unknown = await (await fetch(`${origin}/check/7/subscription`)).json();
  const newest: unknown = Array.isArray(listed) ? listed[0] : undefined;
  const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined);
  const subscription = field(newest, 'subscription');
  const endpoint = field(subscription, 'endpoint');
  const p256dh = field(field(subscription, 'keys'), 'p256dh');
  const auth = field(field(subscription, 'keys'), 'auth');
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    throw new Error(`${origin}/check/7/subscription holds no subscription. Open the page from the home screen and press Allow notifications.`);
  }
  const sent = stamp();
  const message = encoder.encode(JSON.stringify({ title: 'Check 7', body, sent }));
  const answer = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapid(endpoint, keys.privateKey, keys.publicRaw, origin),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '300',
      urgency: 'high',
    },
    body: await encrypt(message, fromBase64url(p256dh), fromBase64url(auth)),
  });
  console.log(`${sent} sent to ${new URL(endpoint).host} (subscribed by ${String(field(newest, 'device'))} at ${String(field(newest, 'at'))}): ${answer.status} ${await answer.text()}`);
  if (answer.status !== 201) {
    process.exit(1);
  }
}
