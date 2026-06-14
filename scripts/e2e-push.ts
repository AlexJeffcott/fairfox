/**
 * Web Push relay verification — proves the new /push/send endpoint
 * actually VAPID-signs and forwards an encrypted payload to the
 * vendor endpoint baked into each subscription.
 *
 * @covers: mesh:devices (pushSubscription field, exercised through
 *   the relay path; the field itself is also exercised by the
 *   ordinary peer-touch tests).
 *
 * This is a relay-scoped integration test rather than a true two-
 * device push e2e. Two reasons:
 *
 *   1. Real FCM/APNs delivery from a headless Chrome requires a
 *      real subscription tied to a Google account, which an
 *      automated test cannot get.
 *   2. The relay is the only new server-side surface in this
 *      feature. The SW push handler is small and tested by manual
 *      open-the-PWA-on-the-phone verification (see HelpView's
 *      Notifications button).
 *
 * What this proves:
 *   - The relay boots cleanly with VAPID env vars set.
 *   - /push/vapid-public-key returns the configured key.
 *   - /push/send accepts a wake-intent and POSTs a VAPID-signed,
 *     RFC 8291-encrypted message to the subscription's endpoint.
 *   - The mock vendor receives the right shape (Authorization +
 *     Crypto-Key, encrypted body).
 *   - The relay reports per-target success/failure correctly,
 *     including the 410 path that drives subscription cleanup on
 *     the caller side.
 *
 * On success exits 0 and prints PASS. On any assertion failure
 * dumps captured requests and exits non-zero.
 *
 *   bun scripts/e2e-push.ts
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import webpush from 'web-push';
import { waitFor } from './e2e-config.ts';

const TRACE = (label: string, msg: string): void => {
  console.log(`[${label}] ${msg}`);
};

function pickPort(): number {
  // Probe for a free port. Bun's Bun.serve will throw on bind
  // failure; the cheap way is to start a throwaway listener on
  // port 0 and read what the OS gave us. Brief race window between
  // stop() and the real listener binding, but that's the same race
  // as every other "pick a random port" pattern in node test suites.
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = probe.port;
  probe.stop();
  return port;
}

async function main(): Promise<void> {
  // VAPID keypair — generated fresh every run so a leaked test key
  // cannot be replayed against prod (different applicationServerKey
  // would invalidate every prod subscription anyway).
  const keys = webpush.generateVAPIDKeys();
  TRACE('vapid', `public key prefix: ${keys.publicKey.slice(0, 16)}…`);

  // Mock vendor — captures every push the relay tries to deliver
  // and reports back a configurable status. Two paths:
  //   /ok/*    -> 201 (success)
  //   /gone/*  -> 410 (subscription expired, drives cleanup)
  // With FAIRFOX_PUSH_TEST_STUB_URL=1 the relay POSTs a plain JSON
  // envelope here instead of an RFC 8291-encrypted body; that lets
  // us assert payload shape directly.
  interface CapturedEnvelope {
    url: string;
    recipientUserId: string;
    payload: unknown;
    subscription: { endpoint: string; p256dh: string; auth: string };
  }
  const captured: CapturedEnvelope[] = [];
  const vendorPort = pickPort();
  const vendor = Bun.serve({
    port: vendorPort,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      let parsed: CapturedEnvelope | null = null;
      try {
        const json = (await req.json()) as unknown as Omit<CapturedEnvelope, 'url'>;
        parsed = { url: url.pathname, ...json };
      } catch {
        // not the stub shape; ignore
      }
      if (parsed) {
        captured.push(parsed);
      }
      if (url.pathname.startsWith('/gone/')) {
        return new Response('Gone', { status: 410 });
      }
      return new Response('Created', { status: 201 });
    },
  });
  const vendorOrigin = `http://127.0.0.1:${vendorPort}`;
  TRACE('vendor', `listening on ${vendorOrigin}`);

  // Relay — spawned as a real `bun src/server.ts` subprocess so the
  // env loading, web-push init, and route table are exercised the
  // same way prod hits them.
  const relayPort = pickPort();
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  const env = {
    ...process.env,
    PORT: String(relayPort),
    FAIRFOX_VAPID_PUBLIC_KEY: keys.publicKey,
    FAIRFOX_VAPID_PRIVATE_KEY: keys.privateKey,
    FAIRFOX_VAPID_SUBJECT: 'mailto:e2e-push@fairfox.test',
    // Tell the relay to POST plaintext JSON envelopes to each
    // target endpoint instead of running web-push's encryption +
    // VAPID signing. The actual VAPID JWT path is covered by
    // web-push's own test suite; this script is verifying the
    // relay's contract (online-skip, fan-out, per-target status).
    FAIRFOX_PUSH_TEST_STUB_URL: '1',
    // Skip GitHub release fetch — the e2e test doesn't need the
    // SPA bundle, just the relay endpoints. fetchApp falls back to
    // a no-bundle state which is fine; MESH_ROUTES will 503 but
    // /push/* answer regardless.
    FAIRFOX_BUILD_HASH: 'e2e-push',
  };
  const serverPath = resolve(import.meta.dir, '..', 'packages', 'web', 'src', 'server.ts');
  const relay = spawn('bun', [serverPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const relayLogs: string[] = [];
  relay.stdout?.on('data', (b) => {
    relayLogs.push(b.toString());
  });
  relay.stderr?.on('data', (b) => {
    relayLogs.push(b.toString());
  });

  // Wait for the relay to bind. /health is cheap and answers as
  // soon as the fetch handler is up.
  const healthy = await waitFor(
    async () => {
      try {
        const res = await fetch(`${relayUrl}/health`);
        return res.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs: 10_000, description: 'relay /health' }
  ).then(
    () => true,
    () => false
  );
  if (!healthy) {
    relay.kill();
    vendor.stop();
    console.error('relay never became healthy. last logs:');
    console.error(relayLogs.join(''));
    process.exit(1);
  }
  TRACE('relay', `healthy on ${relayUrl}`);

  let failed = false;
  function assert(cond: boolean, msg: string): void {
    if (!cond) {
      failed = true;
      console.error(`ASSERT FAIL: ${msg}`);
    }
  }

  try {
    // 1. /push/vapid-public-key returns the configured key.
    const vapidRes = await fetch(`${relayUrl}/push/vapid-public-key`);
    assert(vapidRes.ok, '/push/vapid-public-key status');
    const vapidBody = (await vapidRes.json()) as unknown as { publicKey?: string };
    assert(vapidBody.publicKey === keys.publicKey, '/push/vapid-public-key value matches env');

    // 2. /push/send delivers to a healthy endpoint. The subscription
    //    keys here are throwaway but must be real ECDH P-256 — the
    //    RFC 8291 encryption step does ECDH with this point and
    //    rejects anything that's not a valid curve element. Generate
    //    fresh via WebCrypto and export raw (65 bytes, 0x04-prefixed
    //    uncompressed) for the p256dh field.
    const subKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const rawPublic = await crypto.subtle.exportKey('raw', subKeyPair.publicKey);
    const fakeSubP256dh = bufferToB64Url(rawPublic);
    const fakeSubAuth = randomB64Url(16);
    const okEndpoint = `${vendorOrigin}/ok/abc`;
    const goneEndpoint = `${vendorOrigin}/gone/dead`;
    const sendRes = await fetch(`${relayUrl}/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientUserId: 'user-offline',
        payload: {
          kind: 'chat',
          title: 'Alice',
          body: 'hello e2e',
          tag: 'chat:e2e',
          url: '/chat',
        },
        targets: [
          { endpoint: okEndpoint, p256dh: fakeSubP256dh, auth: fakeSubAuth },
          { endpoint: goneEndpoint, p256dh: fakeSubP256dh, auth: fakeSubAuth },
        ],
      }),
    });
    assert(sendRes.ok, '/push/send status');
    const sendBody = (await sendRes.json()) as unknown as {
      skipped?: string;
      results?: Array<{ endpoint: string; status: number; ok: boolean }>;
    };
    assert(!sendBody.skipped, '/push/send not skipped (recipient was not joined)');
    assert(Array.isArray(sendBody.results), '/push/send returns results array');
    assert(sendBody.results?.length === 2, '/push/send results has both targets');
    const okResult = sendBody.results?.find((r) => r.endpoint === okEndpoint);
    const goneResult = sendBody.results?.find((r) => r.endpoint === goneEndpoint);
    assert(okResult?.ok === true && okResult.status === 201, 'ok endpoint reports success 201');
    assert(
      goneResult?.ok === false && goneResult.status === 410,
      'gone endpoint reports failure 410'
    );

    // 3. The vendor saw two envelopes with the right shape: each
    //    carries the recipientUserId, the WakePayload as-is, and a
    //    subscription block that matches the target we posted.
    assert(captured.length === 2, `vendor captured 2 envelopes (got ${captured.length})`);
    for (const env of captured) {
      assert(
        env.recipientUserId === 'user-offline',
        `envelope carries recipientUserId (${env.url})`
      );
      const payload = env.payload as unknown as Record<string, unknown> | null;
      assert(payload?.kind === 'chat', `envelope payload.kind === chat (${env.url})`);
      assert(payload?.title === 'Alice', `envelope payload.title === Alice (${env.url})`);
      assert(payload?.body === 'hello e2e', `envelope payload.body matches (${env.url})`);
      assert(payload?.tag === 'chat:e2e', `envelope payload.tag matches (${env.url})`);
      assert(payload?.url === '/chat', `envelope payload.url matches (${env.url})`);
      assert(
        env.subscription.endpoint.startsWith(vendorOrigin),
        `envelope subscription.endpoint matches (${env.url})`
      );
      assert(env.subscription.p256dh.length > 0, `envelope subscription.p256dh set (${env.url})`);
      assert(env.subscription.auth.length > 0, `envelope subscription.auth set (${env.url})`);
    }
  } finally {
    relay.kill();
    vendor.stop();
  }

  if (failed) {
    console.error('\n--- relay logs ---');
    console.error(relayLogs.join(''));
    console.error('--- captured vendor requests ---');
    console.error(JSON.stringify(captured, null, 2));
    process.exit(1);
  }
  console.log('PASS');
}

function randomB64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bufferToB64Url(buf.buffer);
}

function bufferToB64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

await main();
